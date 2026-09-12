"""
FixAI — Edge AI Inference Engine
=================================

Loads trained IsolationForest + XGBoost models and computes:
  - anomaly_score  (Isolation Forest, 0..1 higher = more anomalous)
  - p_failure      (XGBoost, P(failure in next 5 min) ∈ [0,1])
  - shap_values    (signed feature attributions explaining the prediction)

All computation runs locally on the host machine — no cloud calls needed.

Usage:
    from ai_engine.inference import EdgeAIEngine

    engine = EdgeAIEngine(model_dir="./models")
    result = engine.predict(cpu=92.0, ram=88.0, latency=3200, error_rate=12.0, disk=44.0)
    print(result.anomaly_score, result.p_failure, result.shap_values)
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import shap
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

logger = logging.getLogger("fixai.ai_engine")

# Feature order — must match training script exactly
FEATURE_NAMES = ["cpu", "ram", "latency", "error_rate", "disk"]


@dataclass
class InferenceResult:
    """Structured output from a single inference pass."""

    anomaly_score: float   # Isolation Forest score (0..1, higher = more anomalous)
    p_failure: float       # XGBoost P(failure in next 5 min) ∈ [0,1]
    risk: str              # "LOW" | "MEDIUM" | "HIGH"
    confidence: float      # model confidence band (0..1)
    shap_values: list[dict] = field(default_factory=list)
    inference_ms: float = 0.0


class EdgeAIEngine:
    """
    Lightweight edge inference engine for FixAI.

    Loads pre-trained .joblib models once at startup, then runs
    fast single-row inference on every telemetry tick.

    Attributes:
        scaler:          StandardScaler fitted during training
        iso_forest:      IsolationForest for anomaly detection
        xgb:             XGBClassifier for failure prediction
        shap_explainer:  SHAP TreeExplainer for feature attributions
        feature_names:   Ordered feature names
    """

    def __init__(self, model_dir: str = "models"):
        """
        Load all model artifacts from disk.

        Args:
            model_dir: Path to directory containing .joblib files.
                       Creates dummy models if files don't exist yet.
        """
        model_path = Path(model_dir)
        self.feature_names = FEATURE_NAMES

        if not model_path.exists():
            model_path.mkdir(parents=True, exist_ok=True)

        # ── Load or create models ──────────────────────────────────────
        self.scaler = self._load_or_create(
            model_path / "scaler.joblib",
            lambda: StandardScaler().fit(np.random.randn(100, len(FEATURE_NAMES))),
            "scaler",
        )

        self.iso_forest = self._load_or_create(
            model_path / "isolation_forest.joblib",
            lambda: IsolationForest(n_estimators=100, random_state=42).fit(
                np.random.randn(100, len(FEATURE_NAMES))
            ),
            "Isolation Forest",
        )

        self.xgb = self._load_or_create(
            model_path / "xgboost_classifier.joblib",
            lambda: XGBClassifier(n_estimators=50, max_depth=4, random_state=42).fit(
                np.random.randn(100, len(FEATURE_NAMES)),
                np.random.randint(0, 2, 100),
            ),
            "XGBoost",
        )

        # ── SHAP explainer (built once, reused) ───────────────────────
        self.shap_explainer: shap.TreeExplainer | None = None
        try:
            self.shap_explainer = shap.TreeExplainer(self.xgb)
            logger.info("SHAP TreeExplainer initialised")
        except Exception as e:
            logger.warning("SHAP TreeExplainer init failed (%s) — using fallback", e)

        logger.info("EdgeAIEngine loaded from %s", model_path.resolve())

    # ── Public API ──────────────────────────────────────────────────────

    def predict(
        self,
        cpu: float,
        ram: float,
        latency: float,
        error_rate: float,
        disk: float,
    ) -> InferenceResult:
        """
        Run a full inference pass on a single telemetry sample.

        Args:
            cpu:        CPU usage percentage (0..100)
            ram:        RAM usage percentage (0..100)
            latency:    HTTP response latency in ms
            error_rate: HTTP 5xx error rate percentage (0..100)
            disk:       Disk usage percentage (0..100)

        Returns:
            InferenceResult with anomaly_score, p_failure, risk, shap_values
        """
        t0 = time.perf_counter()

        features = np.array([[cpu, ram, latency, error_rate, disk]])
        features_scaled = self.scaler.transform(features)

        # ── Anomaly score (Isolation Forest) ──────────────────────────
        raw_anomaly = self.iso_forest.decision_function(features_scaled)[0]
        # decision_function returns offset from 0; negative = anomalous
        # Map to 0..1: more negative → higher anomaly score
        anomaly_score = float(np.clip(0.5 - raw_anomaly, 0.0, 1.0))

        # ── Failure probability (XGBoost) ─────────────────────────────
        p_failure = float(self.xgb.predict_proba(features_scaled)[0, 1])
        p_failure = max(0.001, min(0.999, p_failure))

        # ── Risk classification ───────────────────────────────────────
        if p_failure >= 0.75:
            risk = "HIGH"
        elif p_failure >= 0.50:
            risk = "MEDIUM"
        else:
            risk = "LOW"

        # Confidence falls in the ambiguous middle zone
        confidence = float(np.clip(1.0 - abs(p_failure - 0.5) * 0.7, 0.35, 0.98))

        # ── SHAP attributions ─────────────────────────────────────────
        shap_values = self._compute_shap(features_scaled, features[0])

        inference_ms = (time.perf_counter() - t0) * 1000

        return InferenceResult(
            anomaly_score=round(anomaly_score, 4),
            p_failure=round(p_failure, 4),
            risk=risk,
            confidence=round(confidence, 4),
            shap_values=shap_values,
            inference_ms=round(inference_ms, 2),
        )

    def predict_from_array(self, metrics: list[float]) -> InferenceResult:
        """
        Convenience method: predict from a flat [cpu, ram, latency, err, disk] list.
        """
        if len(metrics) != 5:
            raise ValueError(f"Expected 5 metrics, got {len(metrics)}")
        return self.predict(
            cpu=metrics[0],
            ram=metrics[1],
            latency=metrics[2],
            error_rate=metrics[3],
            disk=metrics[4],
        )

    # ── Private helpers ──────────────────────────────────────────────────

    def _compute_shap(
        self,
        features_scaled: np.ndarray,
        features_raw: np.ndarray,
    ) -> list[dict]:
        """
        Compute SHAP feature attributions for a single prediction.

        Uses TreeExplainer when available; falls back to a weighted
        heuristic approximation (< 1ms, no model dependency).
        """
        if self.shap_explainer is not None:
            try:
                shap_vals = self.shap_explainer.shap_values(features_scaled)
                # shap_vals shape: (1, n_features) or list of arrays
                if isinstance(shap_vals, list):
                    vals = shap_vals[1][0] if len(shap_vals) > 1 else shap_vals[0][0]
                else:
                    vals = shap_vals[0]

                return [
                    {
                        "feature": name,
                        "value": round(float(features_raw[i]), 2),
                        "attribution": round(float(vals[i]), 4),
                    }
                    for i, name in enumerate(self.feature_names)
                ]
            except Exception as e:
                logger.warning("SHAP explainer failed, using fallback: %s", e)

        # Fallback: weighted heuristic (same logic as the TS simulation)
        weights = [0.028, 0.035, 0.0011, 0.045, 0.09]
        baselines = [45.0, 55.0, 300.0, 2.0, 60.0]
        return [
            {
                "feature": name,
                "value": round(float(features_raw[i]), 2),
                "attribution": round((float(features_raw[i]) - baselines[i]) * weights[i], 4),
            }
            for i, name in enumerate(self.feature_names)
        ]

    @staticmethod
    def _load_or_create(path: Path, factory, label: str):
        """Load a joblib artifact or create a dummy one if missing."""
        if path.exists():
            logger.info("Loaded %s from %s", label, path)
            return joblib.load(path)
        logger.warning("Model %s not found at %s — creating dummy", label, path)
        model = factory()
        joblib.dump(model, path)
        return model
