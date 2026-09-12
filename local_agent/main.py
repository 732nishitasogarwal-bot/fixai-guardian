#!/usr/bin/env python3
"""
FixAI Local Agent — main.py

Background service that:
1. Polls real CPU/RAM/Disk metrics via psutil every 2 seconds.
2. Computes IsolationForest anomaly score + XGBoost failure probability + SHAP attributions.
3. POSTs enriched telemetry to Convex HTTP Action every POLL_INTERVAL.
4. Monitors Convex for pending recovery actions and executes approved playbooks.

Run:
    pip install -r requirements.txt
    cp .env.example .env   # fill in CONVEX_URL and CONVEX_DEVICE_API_KEY
    python main.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import psutil
import requests
from dotenv import load_dotenv

# ── Local ML imports ──────────────────────────────────────────────────────
from ai_engine.inference import FixAIInference
from recovery.executor import RecoveryExecutor

# ───────────────────────────────────────────────────────────────────────────
# Config
# ───────────────────────────────────────────────────────────────────────────
load_dotenv()

POLL_INTERVAL: int = int(os.getenv("FIXAI_POLL_INTERVAL", "2"))
SYNC_INTERVAL: int = int(os.getenv("FIXAI_SYNC_INTERVAL", "5"))
CONVEX_URL: str = os.getenv("CONVEX_URL", "https://YOUR_CONVEX_DEPLOYMENT.convex.cloud")
CONVEX_DEVICE_API_KEY: str = os.getenv("CONVEX_DEVICE_API_KEY", "")
DEVICE_NAME: str = os.getenv("FIXAI_DEVICE_NAME", "My Laptop")
AUTO_FIX_ENABLED: bool = os.getenv("FIXAI_AUTO_FIX", "false").lower() == "true"

FEATURE_COLS = ["cpu", "ram", "latency", "errorRate", "disk"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("fixai-agent")

# ───────────────────────────────────────────────────────────────────────────
# Graceful shutdown
# ───────────────────────────────────────────────────────────────────────────
_running = True


def _shutdown(signum: int, _frame: Any) -> None:
    global _running
    log.info("Received signal %s — shutting down gracefully…", signum)
    _running = False


signal.signal(signal.SIGINT, _shutdown)
signal.signal(signal.SIGTERM, _shutdown)

# ───────────────────────────────────────────────────────────────────────────
# Telemetry collector (real hardware via psutil)
# ───────────────────────────────────────────────────────────────────────────


def collect_telemetry() -> Dict[str, Any]:
    """Poll real hardware metrics via psutil."""
    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_io_counters()

    # Simulated latency / error rate — in production these come from the app
    # under observation. For a standalone agent we set conservative zeros.
    latency = 0.0
    error_rate = 0.0

    return {
        "cpu": round(cpu, 1),
        "ram": round(mem.percent, 1),
        "latency": round(latency, 1),
        "errorRate": round(error_rate, 2),
        "disk": round(
            (disk.read_bytes + disk.write_bytes) / (1024 * 1024), 1
        )
        if disk
        else 0.0,
        "ramUsedGb": round(mem.used / (1024**3), 2),
        "ramTotalGb": round(mem.total / (1024**3), 2),
    }


# ───────────────────────────────────────────────────────────────────────────
# Device specs (reported once on first sync)
# ───────────────────────────────────────────────────────────────────────────


def _collect_specs() -> Dict[str, Any]:
    """Gather static hardware specs for the device registration."""
    mem = psutil.virtual_memory()
    return {
        "os": sys.platform,
        "cpuModel": f"{psutil.cpu_count(logical=False) or 'N/A'}-core CPU",
        "cores": psutil.cpu_count(logical=True) or 1,
        "ramGb": round(mem.total / (1024**3), 1),
    }


# ───────────────────────────────────────────────────────────────────────────
# Convex HTTP helpers
# ───────────────────────────────────────────────────────────────────────────

HEADERS = {
    "Content-Type": "application/json",
}


def _api_headers() -> Dict[str, str]:
    """Headers including the device API key."""
    h = dict(HEADERS)
    if CONVEX_DEVICE_API_KEY:
        h["X-API-Key"] = CONVEX_DEVICE_API_KEY
    return h


def _post_ingest(payload: Dict[str, Any]) -> Optional[Dict]:
    """POST telemetry to the Convex ingest endpoint."""
    url = f"{CONVEX_URL}/api/v1/agent/ingest"
    try:
        resp = requests.post(url, json=payload, headers=_api_headers(), timeout=10)
        if resp.ok:
            return resp.json()
        log.warning("Ingest %s — %s", resp.status_code, resp.text[:200])
    except requests.RequestException as exc:
        log.debug("Ingest unreachable: %s", exc)
    return None


def _get_pending_actions() -> Optional[list]:
    """Poll Convex for pending recovery actions (future endpoint)."""
    url = f"{CONVEX_URL}/api/v1/agent/pending-actions"
    try:
        resp = requests.get(
            url,
            headers=_api_headers(),
            params={"device_name": DEVICE_NAME},
            timeout=10,
        )
        if resp.ok:
            data = resp.json()
            return data.get("actions", [])
    except requests.RequestException:
        pass
    return None


def _post_resolve(payload: Dict[str, Any]) -> Optional[Dict]:
    """POST a recovery result back to Convex."""
    url = f"{CONVEX_URL}/api/v1/agent/resolve"
    try:
        resp = requests.post(url, json=payload, headers=_api_headers(), timeout=10)
        if resp.ok:
            return resp.json()
        log.warning("Resolve %s — %s", resp.status_code, resp.text[:200])
    except requests.RequestException as exc:
        log.debug("Resolve unreachable: %s", exc)
    return None


# ───────────────────────────────────────────────────────────────────────────
# Risk classification
# ───────────────────────────────────────────────────────────────────────────


def classify_risk(
    anomaly_score: float,
    p_failure: float,
) -> str:
    """Map AI scores to a risk tier."""
    if p_failure > 0.7 or anomaly_score < -0.4:
        return "HIGH"
    if p_failure > 0.3 or anomaly_score < -0.2:
        return "MEDIUM"
    return "LOW"


def compute_health_score(p_failure: float, anomaly_score: float) -> int:
    """Simple health score: 0-100. Higher is healthier."""
    base = (1 - p_failure) * 100
    penalty = max(0, -anomaly_score) * 20
    return max(0, min(100, int(base - penalty)))


# ───────────────────────────────────────────────────────────────────────────
# Main agent loop
# ───────────────────────────────────────────────────────────────────────────


def run() -> None:
    log.info("═══════════════════════════════════════════════════════════")
    log.info("  FixAI Local Agent starting — device: %s", DEVICE_NAME)
    log.info("  Convex URL : %s", CONVEX_URL or "(not configured)")
    log.info("  Auto-Fix   : %s", "ENABLED" if AUTO_FIX_ENABLED else "disabled")
    log.info("  Polling    : %ds telemetry · %ds cloud sync", POLL_INTERVAL, SYNC_INTERVAL)
    log.info("═══════════════════════════════════════════════════════════")

    # ── Load ML models ──────────────────────────────────────────────────
    inference = FixAIInference()
    executor = RecoveryExecutor(enabled=AUTO_FIX_ENABLED)
    specs = _collect_specs()

    sync_counter = 0
    sample_buffer: list = []

    while _running:
        # ── 1. Collect real hardware metrics ────────────────────────────
        telemetry = collect_telemetry()
        features = [telemetry[col] for col in FEATURE_COLS]

        # ── 2. Run Edge AI inference ────────────────────────────────────
        verdict = inference.predict(features)
        risk = classify_risk(verdict["anomaly_score"], verdict["p_failure"])
        health = compute_health_score(verdict["p_failure"], verdict["anomaly_score"])

        # ── 3. Build the enrichment payload ─────────────────────────────
        sample_entry = {
            "t": int(time.time() * 1000),
            "cpu": telemetry["cpu"],
            "ram": telemetry["ram"],
            "latency": telemetry["latency"],
            "errorRate": telemetry["errorRate"],
            "disk": telemetry["disk"],
        }
        sample_buffer.append(sample_entry)

        incident = None
        audit_entry = None

        if risk in ("MEDIUM", "HIGH"):
            # Determine root cause from SHAP attributions
            top_feature = max(verdict["shap"], key=lambda s: abs(s["attribution"]))
            root_cause_map = {
                "cpu": "CPU Exhaustion",
                "ram": "Memory Exhaustion",
                "latency": "Network Latency Degradation",
                "errorRate": "Application Error Storm",
                "disk": "Disk I/O Saturation",
            }
            primary_cause = root_cause_map.get(
                top_feature["feature"], "Unknown Resource Exhaustion"
            )

            incident = {
                "detectedAt": int(time.time() * 1000),
                "status": "OPEN",
                "failureProbability": verdict["p_failure"],
                "anomalyScore": verdict["anomaly_score"],
                "risk": risk,
                "rootCauseId": f"rca-{int(time.time())}",
                "primaryCause": primary_cause,
                "explanation": _build_explanation(
                    primary_cause, telemetry, verdict["shap"]
                ),
                "shap": verdict["shap"],
                "logEvidence": [],
                "scenarioKey": f"agent_{top_feature['feature']}",
            }

            audit_entry = {
                "timestamp": int(time.time() * 1000),
                "actor": "AI_AGENT",
                "action": f"Anomaly detected — {primary_cause}",
                "decision": "ALERT_GENERATED",
                "reason": f"p_failure={verdict['p_failure']:.2f}, risk={risk}",
            }

            log.warning(
                "⚠  %s detected (risk=%s, p_fail=%.2f, anomaly=%.2f)",
                primary_cause,
                risk,
                verdict["p_failure"],
                verdict["anomaly_score"],
            )

        # ── 4. Sync to Convex (every SYNC_INTERVAL seconds) ────────────
        sync_counter += 1
        if sync_counter >= max(1, SYNC_INTERVAL // POLL_INTERVAL):
            sync_counter = 0
            payload = {
                "device_name": DEVICE_NAME,
                "specs": specs,
                "telemetry": {
                    "cpu": telemetry["cpu"],
                    "ram": telemetry["ram"],
                    "latency": telemetry["latency"],
                    "errorRate": telemetry["errorRate"],
                    "disk": telemetry["disk"],
                },
                "ai_verdict": {
                    "anomalyScore": verdict["anomaly_score"],
                    "pFailure": verdict["p_failure"],
                    "risk": risk,
                    "confidence": verdict["confidence"],
                },
                "shap": verdict["shap"],
                "incident": incident,
                "audit": audit_entry,
            }
            result = _post_ingest(payload)
            if result and result.get("ok"):
                log.info(
                    "☁  Synced — cpu=%.1f%% ram=%.1f%% health=%d risk=%s",
                    telemetry["cpu"],
                    telemetry["ram"],
                    health,
                    risk,
                )
            # Reset buffer after sync
            sample_buffer = []

        # ── 5. Check for pending recovery actions ───────────────────────
        if AUTO_FIX_ENABLED:
            pending = _get_pending_actions()
            if pending:
                for action in pending:
                    log.info("🔧  Executing playbook: %s", action.get("playbook_name"))
                    result = executor.execute(action)
                    _post_resolve(
                        {
                            "incident_id": action.get("incident_id"),
                            "status": "RESOLVED" if result["success"] else "FAILED",
                            "is_health_restored": result["success"],
                            "mode": "AUTOMATED",
                            "playbook_name": action.get("playbook_name", "unknown"),
                            "post_fix_note": result.get("message", ""),
                            "soak_seconds": result.get("soak_seconds", 5),
                        }
                    )

        # ── 6. Sleep ────────────────────────────────────────────────────
        time.sleep(POLL_INTERVAL)

    log.info("Agent stopped.")


# ───────────────────────────────────────────────────────────────────────────
# Explanation builder (template-based, <100ms)
# ───────────────────────────────────────────────────────────────────────────


def _build_explanation(
    cause: str,
    telemetry: Dict[str, Any],
    shap: list,
) -> str:
    """Generate a plain-English explanation from SHAP + telemetry."""
    explanations = {
        "CPU Exhaustion": (
            f"CPU usage is critically high at {telemetry['cpu']}%, indicating the "
            f"processor cannot keep up with workload demand. This will likely cause "
            f"application slowdowns or unresponsiveness within minutes."
        ),
        "Memory Exhaustion": (
            f"RAM usage has reached {telemetry['ram']}% "
            f"({telemetry.get('ramUsedGb', '?')}GB / {telemetry.get('ramTotalGb', '?')}GB), "
            f"leaving insufficient memory for normal operations. The system may begin "
            f"swapping to disk or invoking the OOM killer."
        ),
        "Network Latency Degradation": (
            f"Response latency has spiked to {telemetry['latency']}ms, far above the "
            f"healthy baseline. This suggests network congestion, DNS resolution delays, "
            f"or downstream service unavailability."
        ),
        "Application Error Storm": (
            f"HTTP 5xx error rate is at {telemetry['errorRate']}%, indicating repeated "
            f"server-side failures. The application may be encountering unhandled exceptions "
            f"or dependency timeouts."
        ),
        "Disk I/O Saturation": (
            f"Disk I/O throughput is elevated at {telemetry['disk']}MB, which may cause "
            f"database write delays and application hangs."
        ),
    }
    return explanations.get(cause, f"System anomaly detected: {cause}.")


# ───────────────────────────────────────────────────────────────────────────
# Entry point
# ───────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    run()
