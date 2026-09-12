#!/usr/bin/env python3
"""
FixAI — Offline Model Training Script
======================================

Trains two ML models from synthetic baseline data:
  1. Isolation Forest  — unsupervised anomaly detection
  2. XGBoost Classifier — supervised failure prediction (P(failure))

Outputs (saved to local_agent/models/):
  - isolation_forest.joblib
  - xgboost_classifier.joblib
  - scaler.joblib
  - feature_names.json

Usage:
    python -m ai_engine.train
    python -m ai_engine.train --samples 5000 --out-dir ./models
"""

import argparse
import json
import os
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

# ─── Feature names (must match the live agent's metric order) ───────────
FEATURE_NAMES = ["cpu", "ram", "latency", "error_rate", "disk"]

# ─── Healthy baseline distributions (μ, σ) ─────────────────────────────
# Derived from typical laptop telemetry under normal workload.
HEALTHY_PROFILES = {
    "cpu":       (28.0, 10.0),
    "ram":       (45.0, 8.0),
    "latency":   (120.0, 50.0),
    "error_rate": (0.5, 0.3),
    "disk":      (42.0, 6.0),
}

# ─── Failure profile (mean values when degraded) ────────────────────────
FAILURE_PROFILES = {
    "cpu_spike":     {"cpu": 92.0, "ram": 65.0, "latency": 2800.0, "error_rate": 8.0, "disk": 44.0},
    "memory_leak":   {"cpu": 55.0, "ram": 93.0, "latency": 1900.0, "error_rate": 5.0, "disk": 46.0},
    "latency_storm": {"cpu": 50.0, "ram": 52.0, "latency": 4500.0, "error_rate": 12.0, "disk": 43.0},
    "error_burst":   {"cpu": 45.0, "ram": 50.0, "latency": 1800.0, "error_rate": 35.0, "disk": 44.0},
    "disk_fill":     {"cpu": 35.0, "ram": 48.0, "latency": 250.0, "error_rate": 3.0, "disk": 96.0},
    "db_disconnect": {"cpu": 40.0, "ram": 55.0, "latency": 4800.0, "error_rate": 40.0, "disk": 43.0},
}


def generate_healthy_samples(n: int, rng: np.random.Generator) -> np.ndarray:
    """Generate n healthy telemetry samples from Gaussian baselines."""
    samples = np.column_stack([
        rng.normal(HEALTHY_PROFILES[f][0], HEALTHY_PROFILES[f][1], n)
        for f in FEATURE_NAMES
    ])
    # Clamp to valid ranges
    samples[:, 0] = np.clip(samples[:, 0], 2, 99)       # cpu
    samples[:, 1] = np.clip(samples[:, 1], 5, 99)       # ram
    samples[:, 2] = np.clip(samples[:, 2], 30, 6000)    # latency
    samples[:, 3] = np.clip(samples[:, 3], 0, 60)       # error_rate
    samples[:, 4] = np.clip(samples[:, 4], 5, 99.5)     # disk
    return samples


def generate_failure_samples(n: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate n failure samples across all fault types.
    Returns (samples, labels) where labels=1 means failure.
    """
    per_fault = n // len(FAILURE_PROFILES)
    all_samples = []
    all_labels = []

    for fault_name, means in FAILURE_PROFILES.items():
        samples = np.column_stack([
            rng.normal(means[f], HEALTHY_PROFILES[f][1] * 0.6, per_fault)
            for f in FEATURE_NAMES
        ])
        samples[:, 0] = np.clip(samples[:, 0], 5, 99)
        samples[:, 1] = np.clip(samples[:, 1], 5, 99)
        samples[:, 2] = np.clip(samples[:, 2], 30, 6000)
        samples[:, 3] = np.clip(samples[:, 3], 0, 60)
        samples[:, 4] = np.clip(samples[:, 4], 5, 99.5)
        all_samples.append(samples)
        all_labels.append(np.ones(per_fault, dtype=int))

    return np.vstack(all_samples), np.concatenate(all_labels)


def train(
    n_healthy: int = 4000,
    n_failures: int = 1200,
    out_dir: str = "models",
) -> dict:
    """
    Train both models and save artifacts.

    Returns a metrics dict for display.
    """
    rng = np.random.default_rng(seed=42)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # ── 1. Generate data ────────────────────────────────────────────────
    print("📊 Generating synthetic telemetry data...")
    healthy = generate_healthy_samples(n_healthy, rng)
    failure_samples, failure_labels = generate_failure_samples(n_failures, rng)

    all_samples = np.vstack([healthy, failure_samples])
    all_labels = np.concatenate([
        np.zeros(len(healthy), dtype=int),
        failure_labels,
    ])

    # Shuffle
    perm = rng.permutation(len(all_samples))
    all_samples = all_samples[perm]
    all_labels = all_labels[perm]

    print(f"   Healthy: {n_healthy}  |  Failure: {n_failures}  |  Total: {len(all_samples)}")

    # ── 2. Scale features ──────────────────────────────────────────────
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(all_samples)
    joblib.dump(scaler, out / "scaler.joblib")
    print("✅ Scaler saved")

    # ── 3. Train Isolation Forest (on healthy data only) ───────────────
    print("🌲 Training Isolation Forest...")
    iso_forest = IsolationForest(
        n_estimators=200,
        contamination=0.05,  # expect ~5% anomalies
        max_samples="auto",
        random_state=42,
        n_jobs=-1,
    )
    iso_forest.fit(scaler.transform(healthy))
    joblib.dump(iso_forest, out / "isolation_forest.joblib")
    print("✅ Isolation Forest saved")

    # Evaluate anomaly detection on failure data
    failure_scaled = scaler.transform(failure_samples)
    anomaly_preds = iso_forest.predict(failure_scaled)
    anomaly_recall = (anomaly_preds == -1).mean()  # -1 = anomaly
    print(f"   Anomaly recall on failures: {anomaly_recall:.1%}")

    # ── 4. Train XGBoost (failure prediction) ──────────────────────────
    print("🎯 Training XGBoost failure predictor...")
    pos_count = all_labels.sum()
    neg_count = len(all_labels) - pos_count
    scale_pos_weight = neg_count / max(pos_count, 1)

    xgb = XGBClassifier(
        n_estimators=150,
        max_depth=5,
        learning_rate=0.1,
        scale_pos_weight=scale_pos_weight,
        eval_metric="logloss",
        random_state=42,
        use_label_encoder=False,
    )
    xgb.fit(X_scaled, all_labels)
    joblib.dump(xgb, out / "xgboost_classifier.joblib")
    print("✅ XGBoost classifier saved")

    # Evaluate on held-out failure data (using last 20%)
    split = int(len(all_samples) * 0.8)
    X_test = X_scaled[split:]
    y_test = all_labels[split:]
    xgb_preds = (xgb.predict_proba(X_test)[:, 1] >= 0.5).astype(int)
    tp = int(((xgb_preds == 1) & (y_test == 1)).sum())
    fp = int(((xgb_preds == 1) & (y_test == 0)).sum())
    fn = int(((xgb_preds == 0) & (y_test == 1)).sum())
    tn = int(((xgb_preds == 0) & (y_test == 0)).sum())
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-9)
    mcc_num = tp * tn - fp * fn
    mcc_den = ((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn)) ** 0.5
    mcc = mcc_num / max(mcc_den, 1e-9)

    print(f"   XGBoost on test set: F1={f1:.3f}  MCC={mcc:.3f}  (TP={tp} FP={fp} FN={fn} TN={tn})")

    # ── 5. Save feature names ──────────────────────────────────────────
    (out / "feature_names.json").write_text(json.dumps(FEATURE_NAMES, indent=2))
    print("✅ Feature names saved")

    metrics = {
        "samples_total": len(all_samples),
        "n_healthy": n_healthy,
        "n_failures": n_failures,
        "anomaly_recall": round(anomaly_recall, 4),
        "xgb_f1": round(f1, 4),
        "xgb_mcc": round(mcc, 4),
        "xgb_precision": round(precision, 4),
        "xgb_recall": round(recall, 4),
        "scale_pos_weight": round(scale_pos_weight, 2),
    }

    print(f"\n🎉 All models saved to {out.resolve()}")
    print(f"   Metrics: {json.dumps(metrics, indent=2)}")
    return metrics


def main():
    parser = argparse.ArgumentParser(description="Train FixAI ML models")
    parser.add_argument("--samples", type=int, default=5000, help="Total synthetic samples")
    parser.add_argument("--out-dir", default="models", help="Output directory for .joblib files")
    args = parser.parse_args()

    n_failures = int(args.samples * 0.25)
    n_healthy = args.samples - n_failures
    train(n_healthy=n_healthy, n_failures=n_failures, out_dir=args.out_dir)


if __name__ == "__main__":
    main()
