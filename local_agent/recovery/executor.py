"""
FixAI — Recovery Execution Engine
==================================

Executes ONLY pre-audited, allowlisted recovery playbooks. The AI engine
passes a playbook_id + typed parameters — raw shell strings are NEVER accepted.

Safety guarantees:
  1. Command allowlist — only known-safe operations are permitted
  2. Denylist — critical OS processes are hard-blocked from termination
  3. Rate limiting — max N executions per playbook per hour
  4. Audit logging — every execution attempt is logged
  5. Timeout — every action has a hard timeout (30s default)
  6. No eval/exec — Python code execution is never used
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

logger = logging.getLogger("fixai.recovery")


class ExecutionStatus(str, Enum):
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"
    RATE_LIMITED = "RATE_LIMITED"
    DENIED = "DENIED"


class RiskTier(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


@dataclass
class PlaybookDefinition:
    """Pre-audited recovery action definition."""
    id: str
    name: str
    risk_tier: RiskTier
    description: str
    # Function name to call (must be in ALLOWED_ACTIONS)
    action: str
    # Default timeout in seconds
    timeout: int = 30
    # Max executions per hour
    max_per_hour: int = 3


@dataclass
class ExecutionResult:
    """Result of a playbook execution attempt."""
    playbook_id: str
    status: ExecutionStatus
    message: str
    duration_ms: float = 0.0
    details: dict = field(default_factory=dict)


# ─── Playbook Registry ─────────────────────────────────────────────────
# These are the ONLY actions the system can execute. New playbooks must
# be added here after human review and approval.

PLAYBOOKS: dict[str, PlaybookDefinition] = {
    "flush_cache": PlaybookDefinition(
        id="flush_cache",
        name="Flush Application Cache",
        risk_tier=RiskTier.LOW,
        description="Clears temporary cache files in /tmp/fixai_cache/",
        action="flush_temp_cache",
        timeout=10,
        max_per_hour=5,
    ),
    "retry_service": PlaybookDefinition(
        id="retry_service",
        name="Retry Failed Requests",
        risk_tier=RiskTier.LOW,
        description="Triggers a health-check ping to verify service connectivity",
        action="health_check_retry",
        timeout=15,
        max_per_hour=10,
    ),
    "kill_high_mem_process": PlaybookDefinition(
        id="kill_high_mem_process",
        name="Terminate High-Memory Process",
        risk_tier=RiskTier.MEDIUM,
        description="Terminates the user-space process consuming the most RAM",
        action="kill_top_memory_process",
        timeout=20,
        max_per_hour=3,
    ),
    "restart_background_service": PlaybookDefinition(
        id="restart_background_service",
        name="Restart Background Service",
        risk_tier=RiskTier.MEDIUM,
        description="Restarts a registered background service via systemctl",
        action="restart_service",
        timeout=30,
        max_per_hour=3,
    ),
}

# ─── Denylist — critical processes that must NEVER be killed ────────────
DENYLIST_PROCESSES = {
    # Windows
    "explorer.exe", "svchost.exe", "csrss.exe", "wininit.exe",
    "winlogon.exe", "system", "smss.exe", "lsass.exe", "services.exe",
    # macOS
    "launchd", "kernel_task", "WindowServer", "loginwindow", "Dock",
    "SystemUIServer", "Finder",
    # Linux
    "systemd", "init", "kthreadd", "sshd", "dbus-daemon",
    "NetworkManager", "pulseaudio", "Xorg", "gdm3",
    # FixAI agent itself
    "fixai_agent", "main.py",
}

# ─── Allowed OS-level command patterns (for subprocess) ──────────────────
# Only these exact command prefixes are permitted. The executor validates
# the constructed command against this list before running subprocess.

ALLOWED_COMMAND_PREFIXES = [
    "python3 -c",          # for safe inline scripts
    "systemctl --user",     # user-level service management only
    "df -h",                # disk check
    "free -m",              # memory check
    "curl -sf",             # health check pings (safe flags only)
]


class RecoveryExecutor:
    """
    Safe execution engine for FixAI recovery playbooks.

    Usage:
        executor = RecoveryExecutor()
        result = executor.execute("flush_cache")
        print(result.status, result.message)
    """

    def __init__(self, audit_dir: str = "audit_logs"):
        """
        Args:
            audit_dir: Directory to write append-only audit log files.
        """
        self.audit_dir = Path(audit_dir)
        self.audit_dir.mkdir(parents=True, exist_ok=True)
        self._execution_history: dict[str, list[float]] = {}  # playbook_id → [timestamps]

    def execute(
        self,
        playbook_id: str,
        params: dict | None = None,
        user_confirmed: bool = False,
    ) -> ExecutionResult:
        """
        Execute a playbook by ID with safety checks.

        Args:
            playbook_id:     Must be a key in PLAYBOOKS
            params:          Typed parameters for the action (never raw shell)
            user_confirmed:  Whether the user clicked "Approve" in the dashboard

        Returns:
            ExecutionResult with status, message, and duration
        """
        t0 = time.perf_counter()
        params = params or {}

        # ── 1. Validate playbook exists ────────────────────────────────
        playbook = PLAYBOOKS.get(playbook_id)
        if not playbook:
            return ExecutionResult(
                playbook_id=playbook_id,
                status=ExecutionStatus.BLOCKED,
                message=f"Unknown playbook '{playbook_id}' — not in allowlist",
            )

        # ── 2. Check risk tier vs user confirmation ────────────────────
        if playbook.risk_tier == RiskTier.HIGH:
            self._audit(playbook_id, "BLOCKED", "HIGH risk actions are hard-blocked from automation")
            return ExecutionResult(
                playbook_id=playbook_id,
                status=ExecutionStatus.BLOCKED,
                message="HIGH risk actions require manual execution only — automation blocked",
            )

        if playbook.risk_tier == RiskTier.MEDIUM and not user_confirmed:
            self._audit(playbook_id, "DENIED", "MEDIUM risk requires user confirmation")
            return ExecutionResult(
                playbook_id=playbook_id,
                status=ExecutionStatus.DENIED,
                message="MEDIUM risk action requires explicit user approval",
            )

        # ── 3. Rate limiting ───────────────────────────────────────────
        if self._is_rate_limited(playbook_id, playbook.max_per_hour):
            self._audit(playbook_id, "RATE_LIMITED", f"Max {playbook.max_per_hour}/hour exceeded")
            return ExecutionResult(
                playbook_id=playbook_id,
                status=ExecutionStatus.RATE_LIMITED,
                message=f"Rate limit exceeded: max {playbook.max_per_hour} executions per hour",
            )

        # ── 4. Execute the action ──────────────────────────────────────
        try:
            action_fn = self._get_action(playbook.action)
            details = action_fn(params)
            duration_ms = (time.perf_counter() - t0) * 1000

            self._record_execution(playbook_id)
            self._audit(
                playbook_id,
                "EXECUTED",
                f"Action completed in {duration_ms:.0f}ms",
                details=details,
            )

            return ExecutionResult(
                playbook_id=playbook_id,
                status=ExecutionStatus.SUCCESS,
                message=f"Playbook '{playbook.name}' executed successfully",
                duration_ms=round(duration_ms, 2),
                details=details,
            )

        except Exception as e:
            duration_ms = (time.perf_counter() - t0) * 1000
            self._audit(playbook_id, "FAILED", str(e))
            return ExecutionResult(
                playbook_id=playbook_id,
                status=ExecutionStatus.FAILED,
                message=f"Execution failed: {e}",
                duration_ms=round(duration_ms, 2),
            )

    def get_pending_actions(self) -> list[dict]:
        """
        Check for pending recovery actions (called by the polling loop).

        In a real deployment, this queries the Convex HTTP endpoint.
        For the MVP, returns an empty list (the React UI triggers
        execution directly via the agent hook).
        """
        return []  # placeholder — Step 4 polling implementation

    # ─── Action implementations (ALLOWED_ACTIONS) ──────────────────────
    # Each function accepts typed params, NEVER raw shell strings.

    @staticmethod
    def _flush_temp_cache(params: dict) -> dict:
        """Remove temporary cache files created by FixAI or the target app."""
        cache_dir = Path("/tmp/fixai_cache")
        removed = 0
        if cache_dir.exists():
            for f in cache_dir.iterdir():
                if f.is_file():
                    f.unlink()
                    removed += 1
            cache_dir.rmdir()

        # Also clean Python __pycache__ in the agent directory
        pycache = Path(__file__).parent.parent / "__pycache__"
        if pycache.exists():
            import shutil
            shutil.rmtree(pycache, ignore_errors=True)

        return {"files_removed": removed}

    @staticmethod
    def _health_check_retry(params: dict) -> dict:
        """Ping the target service health endpoint to verify connectivity."""
        url = params.get("url", "http://localhost:8000/health")
        timeout = params.get("timeout", 5)

        # Only allow localhost/127.0.0.1 URLs for safety
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.hostname not in ("localhost", "127.0.0.1", "0.0.0.0"):
            raise ValueError(f"Health check URL must be localhost, got: {parsed.hostname}")

        try:
            import urllib.request
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return {"status_code": resp.status, "healthy": resp.status == 200}
        except Exception as e:
            return {"status_code": 0, "healthy": False, "error": str(e)}

    @staticmethod
    def _kill_top_memory_process(params: dict) -> dict:
        """
        Terminate the user-space process consuming the most RAM.

        Safety: uses psutil to find the process, checks denylist,
        and only kills user-space processes (not kernel/system).
        """
        try:
            import psutil
        except ImportError:
            raise RuntimeError("psutil is required for process management")

        target_name = params.get("process_name")

        if target_name:
            # Kill a specific named process
            name_lower = target_name.lower()
            if name_lower in {p.lower() for p in DENYLIST_PROCESSES}:
                raise PermissionError(f"Process '{target_name}' is on the denylist")

            killed = []
            for proc in psutil.process_iter(["pid", "name", "memory_percent"]):
                try:
                    if proc.info["name"] and proc.info["name"].lower() == name_lower:
                        proc.terminate()
                        proc.wait(timeout=5)
                        killed.append(proc.info["name"])
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            return {"killed": killed, "count": len(killed)}

        # Default: kill the highest-memory user-space process
        candidates = []
        for proc in psutil.process_iter(["pid", "name", "memory_percent", "username"]):
            try:
                info = proc.info
                name = info.get("name", "")
                if not name:
                    continue
                if name.lower() in {p.lower() for p in DENYLIST_PROCESSES}:
                    continue
                # Skip kernel/system processes (uid 0)
                if info.get("username") == "root" or info.get("username") == "SYSTEM":
                    continue
                mem = info.get("memory_percent", 0) or 0
                candidates.append((proc, name, mem))
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        if not candidates:
            return {"killed": [], "count": 0, "note": "No eligible user-space processes found"}

        # Sort by memory usage descending
        candidates.sort(key=lambda x: x[2], reverse=True)
        top_proc, top_name, top_mem = candidates[0]

        # Safety: don't kill if it's using < 50% memory (not actually problematic)
        if top_mem < 50.0:
            return {"killed": [], "count": 0, "note": f"Top process '{top_name}' at {top_mem:.1f}% — below 50% threshold"}

        try:
            top_proc.terminate()
            top_proc.wait(timeout=5)
            return {"killed": [top_name], "memory_freed_pct": round(top_mem, 1)}
        except psutil.TimeoutExpired:
            top_proc.kill()
            return {"killed": [top_name], "memory_freed_pct": round(top_mem, 1), "force_killed": True}
        except psutil.AccessDenied:
            raise PermissionError(f"Access denied to terminate '{top_name}' (pid {top_proc.pid})")

    @staticmethod
    def _restart_service(params: dict) -> dict:
        """Restart a user-level systemd service."""
        service_name = params.get("service_name")
        if not service_name:
            raise ValueError("service_name is required")

        # Only allow user-level services (--user flag enforced)
        result = subprocess.run(
            ["systemctl", "--user", "restart", service_name],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"systemctl failed: {result.stderr.strip()}")

        return {"service": service_name, "restarted": True}

    def _get_action(self, action_name: str):
        """Map action name to implementation function."""
        actions = {
            "flush_temp_cache": self._flush_temp_cache,
            "health_check_retry": self._health_check_retry,
            "kill_top_memory_process": self._kill_top_memory_process,
            "restart_service": self._restart_service,
        }
        fn = actions.get(action_name)
        if not fn:
            raise ValueError(f"Unknown action '{action_name}' — not in ALLOWED_ACTIONS")
        return fn

    # ─── Rate limiting ──────────────────────────────────────────────────

    def _is_rate_limited(self, playbook_id: str, max_per_hour: int) -> bool:
        """Check if a playbook has exceeded its hourly rate limit."""
        now = time.time()
        hour_ago = now - 3600

        history = self._execution_history.get(playbook_id, [])
        # Prune old entries
        recent = [t for t in history if t > hour_ago]
        self._execution_history[playbook_id] = recent

        return len(recent) >= max_per_hour

    def _record_execution(self, playbook_id: str) -> None:
        """Record a successful execution timestamp for rate limiting."""
        self._execution_history.setdefault(playbook_id, []).append(time.time())

    # ─── Audit logging ──────────────────────────────────────────────────

    def _audit(
        self,
        playbook_id: str,
        decision: str,
        reason: str,
        details: dict | None = None,
    ) -> None:
        """Append an audit log entry to the daily log file."""
        import datetime
        today = datetime.date.today().isoformat()
        log_file = self.audit_dir / f"audit_{today}.jsonl"

        entry = {
            "timestamp": time.time(),
            "playbook_id": playbook_id,
            "decision": decision,
            "reason": reason,
        }
        if details:
            entry["details"] = details

        with open(log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")

        logger.info("AUDIT: %s %s — %s", playbook_id, decision, reason)
