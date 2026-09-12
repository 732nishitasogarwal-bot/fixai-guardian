#!/usr/bin/env python3
"""
FixAI — Fault Injection Script for Live Demos
==============================================

A safe, self-terminating Python script that artificially creates system stress
conditions to demonstrate FixAI's anomaly detection and self-healing capabilities.

Usage:
    python simulate_fault.py --fault cpu --duration 60
    python simulate_fault.py --fault memory --duration 30
    python simulate_fault.py --fault disk --duration 20

Safety:
    - All faults are SELF-TERMINATING (max duration enforced by timer)
    - CPU fault uses busy-wait loops that die on KeyboardInterrupt
    - Memory fault uses pre-allocated blocks that are freed on exit
    - Disk fault creates temp files that are cleaned up automatically
    - The script will NOT freeze your computer permanently

Requirements:
    - Python 3.8+
    - psutil (pip install psutil) — optional, for live monitoring output
"""

import argparse
import math
import os
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path


# ─── Global shutdown flag ────────────────────────────────────────────────
_stop = threading.Event()


def _signal_handler(sig, frame):
    """Graceful shutdown on Ctrl+C or SIGTERM."""
    print("\n⏹️  Stopping fault injection...")
    _stop.set()


signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)


# ─── Optional: psutil live monitor ──────────────────────────────────────
def _print_stats(interval: float = 2.0):
    """Print live CPU/RAM stats in a background thread (if psutil available)."""
    try:
        import psutil
    except ImportError:
        return

    while not _stop.is_set():
        cpu = psutil.cpu_percent(interval=interval)
        mem = psutil.virtual_memory().percent
        print(f"  📊  CPU: {cpu:5.1f}%  │  RAM: {mem:5.1f}%", flush=True)
        if _stop.is_set():
            break


# ─── Fault: CPU Spike ──────────────────────────────────────────────────
def _fault_cpu(duration: int):
    """
    Simulate a CPU spike by running compute-heavy math in multiple threads.

    Uses trigonometric and logarithmic operations to peg CPU cores without
    being a security risk (no network, no file I/O).
    """
    print(f"🔥 Injecting CPU spike for {duration} seconds...")

    def _burn():
        end = time.time() + duration
        while time.time() < end and not _stop.is_set():
            # Heavy math to saturate CPU
            for _ in range(1000):
                math.sin(1.23) * math.log(4.56) + math.sqrt(7.89)
                math.tan(0.42) * math.exp(0.31)

    num_threads = min(os.cpu_count() or 4, 8)
    threads = []
    for _ in range(num_threads):
        t = threading.Thread(target=_burn, daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join(timeout=duration + 2)

    print("✅ CPU spike completed. Usage returning to normal.")


# ─── Fault: Memory Leak ────────────────────────────────────────────────
def _fault_memory(duration: int, target_mb: int = 512):
    """
    Simulate a memory leak by progressively allocating memory blocks.

    Allocates ~50MB every 2 seconds up to target_mb, then holds for the
    remaining duration before freeing everything.
    """
    print(f"💾 Injecting memory leak for {duration} seconds (target: {target_mb}MB)...")

    blocks: list[bytearray] = []
    block_size = 50 * 1024 * 1024  # 50MB
    interval = 2.0
    allocated = 0

    start = time.time()
    while time.time() - start < duration and not _stop.is_set():
        if allocated < target_mb * 1024 * 1024:
            try:
                blocks.append(bytearray(block_size))
                allocated += block_size
                print(f"  📦  Allocated {allocated // (1024*1024)}MB / {target_mb}MB")
            except MemoryError:
                print(f"  ⚠️  Could not allocate more memory at {allocated // (1024*1024)}MB")
                break

        # Hold — don't allocate more, just wait
        remaining = min(interval, duration - (time.time() - start))
        if remaining > 0:
            _stop.wait(timeout=remaining)

    # Free everything
    print(f"  🗑️  Freeing {len(blocks)} blocks ({allocated // (1024*1024)}MB)...")
    blocks.clear()
    print("✅ Memory leak cleared. Usage returning to normal.")


# ─── Fault: Disk Fill ──────────────────────────────────────────────────
def _fault_disk(duration: int, target_mb: int = 200):
    """
    Simulate disk fill by creating temporary files in the system temp directory.

    Files are created in 10MB chunks up to target_mb, then held for the
    remaining duration before automatic cleanup.
    """
    print(f"📀 Injecting disk fill for {duration} seconds (target: {target_mb}MB)...")

    tmpdir = Path(tempfile.mkdtemp(prefix="fixai_fault_"))
    chunk_size = 10 * 1024 * 1024  # 10MB
    written = 0
    file_index = 0

    start = time.time()
    while time.time() - start < duration and not _stop.is_set():
        if written < target_mb * 1024 * 1024:
            filepath = tmpdir / f"fault_chunk_{file_index:04d}.dat"
            try:
                filepath.write_bytes(os.urandom(chunk_size))
                written += chunk_size
                file_index += 1
                print(f"  📝  Written {written // (1024*1024)}MB / {target_mb}MB")
            except OSError as e:
                print(f"  ⚠️  Disk write failed: {e}")
                break

        remaining = min(2.0, duration - (time.time() - start))
        if remaining > 0:
            _stop.wait(timeout=remaining)

    # Cleanup
    print(f"  🗑️  Cleaning up {tmpdir}...")
    for f in tmpdir.iterdir():
        f.unlink(missing_ok=True)
    tmpdir.rmdir()
    print("✅ Disk fill cleared. Space reclaimed.")


# ─── Fault: Latency Storm ──────────────────────────────────────────────
def _fault_latency(duration: int, delay_ms: int = 500):
    """
    Simulate high latency by sleeping in a loop and printing warnings.

    This doesn't actually affect network — it demonstrates the concept.
    For a real app, you'd add delays to the request handler.
    """
    print(f"⏱️  Simulating latency storm ({delay_ms}ms delay) for {duration} seconds...")
    start = time.time()
    while time.time() - start < duration and not _stop.is_set():
        elapsed = time.time() - start
        print(f"  🐌  Simulated request latency: {delay_ms}ms (elapsed: {elapsed:.0f}s)")
        _stop.wait(timeout=delay_ms / 1000.0)
    print("✅ Latency storm subsided.")


# ─── Fault: Error Burst ────────────────────────────────────────────────
def _fault_errors(duration: int):
    """
    Simulate an error burst by logging fake exception traces.

    Prints stack-trace-style errors to stdout at high frequency.
    """
    print(f"❌ Simulating error burst for {duration} seconds...")
    error_types = [
        "ConnectionTimeoutError",
        "MemoryError",
        "UnhandledException",
        "DatabasePoolExhaustedError",
        "ServiceUnavailableError",
    ]

    start = time.time()
    count = 0
    while time.time() - start < duration and not _stop.is_set():
        err = error_types[count % len(error_types)]
        print(f"  💥  [{count+1}] ERROR routes.handler: {err}: Request failed on worker-{count % 8}")
        count += 1
        _stop.wait(timeout=0.3)

    print(f"✅ Error burst ended. {count} simulated errors.")


# ─── Fault: DB Disconnect ──────────────────────────────────────────────
def _fault_db(duration: int):
    """
    Simulate database connection failure by printing connection refused messages.
    """
    print(f"🗄️  Simulating database disconnection for {duration} seconds...")
    start = time.time()
    count = 0
    while time.time() - start < duration and not _stop.is_set():
        count += 1
        print(f"  🔌  ERROR db.pool ConnectionRefusedError: could not connect to postgres:5432 (attempt {count})")
        _stop.wait(timeout=1.0)
    print(f"✅ DB simulation ended. {count} failed connection attempts.")


# ─── Main ────────────────────────────────────────────────────────────────
FAULTS = {
    "cpu": ("CPU Spike", _fault_cpu),
    "memory": ("Memory Leak", _fault_memory),
    "disk": ("Disk Fill", _fault_disk),
    "latency": ("Latency Storm", _fault_latency),
    "error": ("Error Burst", _fault_errors),
    "db": ("DB Disconnect", _fault_db),
}


def main():
    parser = argparse.ArgumentParser(
        description="FixAI — Safe fault injection for live demos",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python simulate_fault.py --fault cpu --duration 60
  python simulate_fault.py --fault memory --duration 30 --target-mb 256
  python simulate_fault.py --fault disk --duration 20 --target-mb 100
  python simulate_fault.py --fault error --duration 45
        """,
    )
    parser.add_argument(
        "--fault",
        choices=list(FAULTS.keys()),
        required=True,
        help="Type of fault to inject",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=60,
        help="Duration in seconds (default: 60)",
    )
    parser.add_argument(
        "--target-mb",
        type=int,
        default=None,
        help="Target MB for memory/disk faults (default: 512 for memory, 200 for disk)",
    )
    parser.add_argument(
        "--no-monitor",
        action="store_true",
        help="Disable live CPU/RAM monitoring output",
    )

    args = parser.parse_args()

    name, func = FAULTS[args.fault]
    print(f"\n{'='*60}")
    print(f"  FixAI Fault Injection — {name}")
    print(f"  Duration: {args.duration}s")
    print(f"{'='*60}\n")

    # Start live monitoring in background
    monitor = None
    if not args.no_monitor:
        try:
            import psutil  # noqa: F401
            monitor = threading.Thread(target=_print_stats, daemon=True)
            monitor.start()
        except ImportError:
            print("  ℹ️  Install psutil for live CPU/RAM monitoring: pip install psutil\n")

    # Run the fault
    kwargs = {"duration": args.duration}
    if args.fault in ("memory", "disk") and args.target_mb:
        kwargs["target_mb"] = args.target_mb

    try:
        func(**kwargs)
    except Exception as e:
        print(f"\n❌ Fault injection failed: {e}")
        sys.exit(1)
    finally:
        _stop.set()

    print(f"\n{'='*60}")
    print("  ✅ Fault injection complete. System is recovering.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
