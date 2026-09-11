import { rankRecoveryOptions } from "./policy";
import type {
  ActionPermission,
  AiVerdict,
  RecoveryOption,
  RootCause,
  ShapAttribution,
  TelemetrySample,
} from "./types";

/**
 * Agentic telemetry simulation + AI analytics engine.
 *
 * Stands in for the Python agent (psutil + Prometheus) and the XGBoost/SHAP
 * pipeline so the closed healing loop is fully demonstrable in-browser:
 *   stream → anomaly score → failure probability → SHAP attribution → RCA.
 */

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Sigmoid for mapping a composite stress signal into P(failure) ∈ [0,1]. */
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Smooth noise so charts look like real telemetry, not white noise. */
function jitter(prev: number, amt: number): number {
  return prev + (Math.random() - 0.5) * amt;
}

export type FaultKey =
  | "none"
  | "cpu_spike"
  | "memory_leak"
  | "disk_fill"
  | "latency_storm"
  | "error_burst"
  | "db_disconnect";

export const FAULTS: Record<
  Exclude<FaultKey, "none">,
  { label: string; description: string }
> = {
  cpu_spike: {
    label: "High CPU Spike",
    description: "Infinite loop thread pegs the CPU and starves request handling.",
  },
  memory_leak: {
    label: "Memory Exhaustion",
    description: "Buffer overflow pattern; RAM climbs until the container is OOM-killed.",
  },
  disk_fill: {
    label: "Disk Space Fill",
    description: "Temp artifacts accumulate until the mount hits 98%.",
  },
  latency_storm: {
    label: "High Response Latency",
    description: "time.sleep(5) in the request pipeline; pool saturation.",
  },
  error_burst: {
    label: "High Error Rate",
    description: "Unhandled exceptions on 50% of API calls; 5xx burst.",
  },
  db_disconnect: {
    label: "DB Connection Drop",
    description: "Connection pool exhausts; Postgres pings time out.",
  },
};

export interface SimState {
  /** Rolling window of samples (newest last). */
  samples: TelemetrySample[];
  fault: FaultKey;
  /** 0..1 progression of the active fault. */
  faultProgress: number;
}

/** One simulated OS "tick" of the target system. */
export function nextSample(state: SimState): SimState {
  const last = state.samples[state.samples.length - 1] ?? {
    t: Date.now(),
    cpu: 24,
    ram: 42,
    latency: 110,
    errorRate: 0.2,
    disk: 38,
  };

  let cpu = clamp(jitter(last.cpu, 6), 3, 99);
  let ram = clamp(jitter(last.ram, 3), 10, 99);
  let latency = clamp(jitter(last.latency, 30), 40, 6000);
  let errorRate = clamp(jitter(last.errorRate, 0.6), 0, 60);
  let disk = clamp(jitter(last.disk, 0.4), 5, 99.5);
  let progress = state.faultProgress;

  switch (state.fault) {
    case "cpu_spike":
      cpu = clamp(last.cpu + 7 + Math.random() * 6, 20, 97);
      latency = clamp(last.latency + 220, 80, 5200);
      break;
    case "memory_leak":
      ram = clamp(last.ram + 4.5 + Math.random() * 3, 20, 96);
      cpu = clamp(last.cpu + 2.5, 10, 95);
      latency = clamp(last.latency + 140, 60, 4800);
      break;
    case "disk_fill":
      disk = clamp(last.disk + 3.4, 10, 98.8);
      break;
    case "latency_storm":
      latency = clamp(last.latency + 380, 80, 5600);
      cpu = clamp(last.cpu + 3, 10, 90);
      break;
    case "error_burst":
      errorRate = clamp(last.errorRate + 4.2, 0, 48);
      latency = clamp(last.latency + 90, 60, 2500);
      break;
    case "db_disconnect":
      errorRate = clamp(last.errorRate + 5.5, 0, 46);
      latency = clamp(last.latency + 500, 100, 5900);
      cpu = clamp(last.cpu + 2, 10, 85);
      break;
    case "none":
      // Gentle pull back toward a healthy baseline.
      cpu += (24 - cpu) * 0.18;
      ram += (42 - ram) * 0.18;
      latency += (110 - latency) * 0.18;
      errorRate += (0.3 - errorRate) * 0.3;
      disk += (38 - disk) * 0.12;
      break;
  }

  const sample: TelemetrySample = {
    t: Date.now(),
    cpu: clamp(cpu, 1, 99),
    ram: clamp(ram, 5, 99),
    latency: clamp(latency, 40, 6000),
    errorRate: clamp(errorRate, 0, 60),
    disk: clamp(disk, 5, 99.5),
  };

  const samples = [...state.samples, sample].slice(-90);
  progress = clamp(progress + 0.08, 0, 1);

  return { samples, fault: state.fault, faultProgress: progress };
}

/**
 * Isolation Forest stand-in: composite stress distance from the healthy
 * baseline, normalised to 0..1 (higher = more anomalous).
 */
export function computeAnomalyScore(s: TelemetrySample): number {
  const deviations = [
    (s.cpu - 45) / 45,
    (s.ram - 55) / 45,
    (s.latency - 300) / 1500,
    (s.errorRate - 2) / 12,
    (s.disk - 60) / 40,
  ];
  const stress = deviations.reduce(
    (acc, d) => acc + Math.max(0, d) ** 1.5,
    0,
  );
  return clamp(1 - Math.exp(-stress * 0.9), 0, 1);
}

/** XGBoost stand-in: composite logistic risk over the 5-minute lead window. */
export function predictFailure(s: TelemetrySample): number {
  const z =
    0.055 * (s.cpu - 45) +
    0.07 * (s.ram - 55) +
    0.0022 * (s.latency - 300) +
    0.09 * (s.errorRate - 2) +
    0.045 * (s.disk - 60);
  return clamp(sigmoid(z), 0.004, 0.996);
}

export function riskFromProbability(p: number): AiVerdict["risk"] {
  if (p >= 0.75) return "HIGH";
  if (p >= 0.5) return "MEDIUM";
  return "LOW";
}

export function deriveVerdict(s: TelemetrySample): AiVerdict {
  const anomalyScore = computeAnomalyScore(s);
  const failureProbability = predictFailure(s);
  const risk = riskFromProbability(failureProbability);
  // Confidence falls as the sample sits in the decision boundary region.
  const confidence = clamp(1 - Math.abs(failureProbability - 0.5) * 0.7, 0.35, 0.98);
  return { anomalyScore, failureProbability, risk, confidence };
}

export function healthScoreFrom(s: TelemetrySample, risk: number): number {
  const metricHealth =
    (100 - s.cpu) * 0.2 +
    (100 - s.ram) * 0.2 +
    (100 - clamp(s.latency / 60, 0, 100)) * 0.25 +
    (100 - clamp(s.errorRate * 8, 0, 100)) * 0.25 +
    (100 - s.disk) * 0.1;
  return Math.round(clamp(metricHealth * 0.75 + (1 - risk) * 100 * 0.25, 0, 100));
}

export function statusFromScore(score: number): "HEALTHY" | "DEGRADED" | "CRITICAL" {
  if (score >= 70) return "HEALTHY";
  if (score >= 45) return "DEGRADED";
  return "CRITICAL";
}

/** SHAP-style signed attributions for the current prediction. */
export function computeShap(s: TelemetrySample): ShapAttribution[] {
  const attrs: { feature: string; value: number; w: number; fmt: string }[] = [
    { feature: "CPU Usage", value: s.cpu, w: 0.028, fmt: "%" },
    { feature: "Memory Usage", value: s.ram, w: 0.035, fmt: "%" },
    { feature: "Response Latency", value: s.latency, w: 0.0011, fmt: "ms" },
    { feature: "HTTP 5xx Rate", value: s.errorRate, w: 0.045, fmt: "%" },
    { feature: "Disk Usage", value: s.disk, w: 0.022, fmt: "%" },
  ];
  return attrs
    .map((a) => ({
      feature: a.feature,
      value: a.value,
      attribution: (a.value - 50) * a.w,
    }))
    .sort((a, b) => b.attribution - a.attribution);
}

/** Log lines "fused" with the metric spike for RCA evidence. */
export function collectLogEvidence(
  s: TelemetrySample,
  fault: FaultKey,
): string[] {
  const t = new Date().toLocaleTimeString();
  const lines: string[] = [];
  if (s.ram > 88) lines.push(`[${t}] ERROR worker.6 MemoryError: Out of memory (heap 96%)`);
  if (s.cpu > 90) lines.push(`[${t}] WARN  scheduler CPU starvation detected on 3 threads`);
  if (s.latency > 2500) lines.push(`[${t}] ERROR gateway upstream_timeout after 5000ms — pool exhausted`);
  if (s.errorRate > 20) lines.push(`[${t}] ERROR api.routes Unhandled Exception: 500 on 42% of requests`);
  if (s.disk > 95) lines.push(`[${t}] CRIT  storage /tmp write failed: No space left on device`);
  if (fault === "db_disconnect")
    lines.push(`[${t}] ERROR db.pool ConnectionRefusedError: could not connect to postgres:5432`);
  if (lines.length === 0)
    lines.push(`[${t}] INFO  healthcheck /health returned 200 OK in ${Math.round(s.latency)}ms`);
  return lines.slice(0, 4);
}

export function deriveRootCause(
  s: TelemetrySample,
  fault: FaultKey,
  verdict: AiVerdict,
): RootCause {
  const shap = computeShap(s);
  const evidence = collectLogEvidence(s, fault);
  const top = shap[0];

  let primaryCause = "Resource Pressure";
  let explanation =
    "Aggregate resource pressure is elevated, but the system remains within recoverable bounds. Continue monitoring.";

  if (s.errorRate > 18 && (fault === "db_disconnect" || s.latency > 1800)) {
    primaryCause = fault === "db_disconnect" ? "Database Connection Failure" : "Cascade Failure: Errors × Latency";
    explanation =
      fault === "db_disconnect"
        ? `The service is failing because database connections are being refused at the pool level. 5xx rate is ${s.errorRate.toFixed(1)}% and latency is ${Math.round(s.latency)}ms — reset the connection pool or restart the container to re-seat clients.`
        : `Unhandled exceptions (${s.errorRate.toFixed(1)}% of requests) are compounding latency (${Math.round(s.latency)}ms). The error burst is the primary driver pushing ${top.feature.toLowerCase()} risk upward.`;
  } else if (s.disk > 90) {
    primaryCause = "Storage Exhaustion";
    explanation = `Disk usage has reached ${s.disk.toFixed(1)}% on the primary mount. Write pressure will degrade logs and database durability. Purge temporary artifacts or expand the volume.`;
  } else if (s.ram > 85) {
    primaryCause = "Memory Exhaustion";
    explanation = `The service is at high risk of crashing because memory usage (${s.ram.toFixed(1)}%) and ${top.feature.toLowerCase()} exceeded safe operational thresholds. A container restart reclaims the leaked heap.`;
  } else if (s.cpu > 88) {
    primaryCause = "CPU Starvation";
    explanation = `CPU utilisation is pinned at ${s.cpu.toFixed(1)}%, starving the request scheduler. Latency has risen to ${Math.round(s.latency)}ms as requests queue behind compute-bound threads.`;
  } else if (s.latency > 2200) {
    primaryCause = "Thread Blocking / Slow Query";
    explanation = `Response latency has degraded to ${Math.round(s.latency)}ms while CPU and memory remain moderate — consistent with a blocking call or slow query holding the connection pool.`;
  } else if (verdict.failureProbability >= 0.5) {
    primaryCause = "Emerging Resource Pressure";
    explanation = `The predictor flagged a rising trajectory (${(verdict.failureProbability * 100).toFixed(0)}% failure probability) before hard thresholds were breached. Early intervention is cheap now; waiting will not be.`;
  }

  return { id: `rca-${Date.now()}`, primaryCause, explanation, shap, logEvidence: evidence };
}

export function recommendActions(
  s: TelemetrySample,
  verdict: AiVerdict,
  permissions: ActionPermission[],
): RecoveryOption[] {
  return rankRecoveryOptions(verdict, s, permissions);
}

export function initialSamples(count = 45): TelemetrySample[] {
  let state: SimState = { samples: [], fault: "none", faultProgress: 0 };
  for (let i = 0; i < count; i++) state = nextSample(state);
  return state.samples;
}

/** Baseline snapshot used for pre/post-fix comparison. */
export function baselineSample(): TelemetrySample {
  return { t: Date.now(), cpu: 24, ram: 42, latency: 110, errorRate: 0.3, disk: 38 };
}
