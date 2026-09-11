import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DEFAULT_PERMISSIONS, evaluatePolicy, getPermissionFor } from "@/lib/policy";
import {
  baselineSample,
  deriveRootCause,
  deriveVerdict,
  healthScoreFrom,
  initialSamples,
  nextSample,
  recommendActions,
  riskFromProbability,
  statusFromScore,
  type FaultKey,
  type SimState,
} from "@/lib/telemetry";
import type {
  AiVerdict,
  Incident,
  RecoveryOption,
  RootCause,
  TelemetrySample,
} from "@/lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

export interface ActiveEpisode {
  incident: Incident;
  options: RecoveryOption[];
  preFix: TelemetrySample;
  verdict: AiVerdict;
}

export interface FixAiAgent {
  /** Latest verdict + live window. */
  current: TelemetrySample;
  samples: TelemetrySample[];
  verdict: AiVerdict;
  healthScore: number;
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  fault: FaultKey;
  isMonitoring: boolean;
  /** Active incident awaiting user action, if any. */
  episode: ActiveEpisode | null;
  /** Terminal-style lines of the last automated execution. */
  executionLog: string[];
  isExecuting: boolean;
  /** Post-fix validation result for the last episode. */
  validationResult: {
    restored: boolean;
    pre: TelemetrySample;
    post: TelemetrySample;
  } | null;

  injectFault: (fault: FaultKey) => void;
  clearFault: () => void;
  setMonitoring: (on: boolean) => void;
  dismissEpisode: () => void;
  executeAutomated: (option: RecoveryOption) => Promise<void>;
  completeManualFix: () => Promise<void>;
}

const SPEC_MODELS = ["Dell XPS 15", "ThinkPad X1 Carbon", "MacBook Pro 14", "HP Spectre x360"];

/**
 * The closed healing loop, simulated in-browser (agent → prediction → RCA →
 * policy → execution → validation → persistence). The same state machine the
 * Python agent would drive; UI reads it reactively.
 */
export function useFixAiAgent(): FixAiAgent {
  const { isAuthenticated } = useConvexAuth();
  const device = useQuery(api.devices.getMyDevice, isAuthenticated ? {} : "skip");
  const ensureDevice = useMutation(api.devices.ensureDevice);
  const ingest = useMutation(api.devices.ingestTelemetry);

  const [samples, setSamples] = useState<TelemetrySample[]>(() => initialSamples(45));
  const [fault, setFault] = useState<FaultKey>("none");
  const [isMonitoring, setMonitoring] = useState(true);
  const [episode, setEpisode] = useState<ActiveEpisode | null>(null);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [validation, setValidation] = useState<FixAiAgent["validationResult"]>(null);
  const [deviceId, setDeviceId] = useState<Id<"devices"> | null>(null);

  const simRef = useRef<SimState>({ samples: [], fault: "none", faultProgress: 0 });
  const faultRef = useRef<FaultKey>("none");
  const episodeRef = useRef<ActiveEpisode | null>(null);
  const cooldownRef = useRef(false);
  const persistedRef = useRef(false);

  // Seed sim state once.
  useEffect(() => {
    simRef.current = { samples: initialSamples(45), fault: "none", faultProgress: 0 };
  }, []);

  const permissions = useMemo(() => DEFAULT_PERMISSIONS, []);

  // Register the device when authed.
  useEffect(() => {
    if (!isAuthenticated || device) return;
    let cancelled = false;
    void (async () => {
      try {
        const id = await ensureDevice({
          name: navigator.platform
            ? `${SPEC_MODELS[0]} · ${navigator.platform.slice(0, 12)}`
            : SPEC_MODELS[0],
          specs: {
            os: "Ubuntu 24.04 LTS",
            cpuModel: "Intel Core Ultra 7 155H",
            cores: 16,
            ramGb: 32,
          },
          agentOnline: true,
        });
        if (!cancelled) setDeviceId(id);
      } catch (err) {
        console.warn("Device registration failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, device, ensureDevice]);

  // The monitoring loop — one telemetry tick every 2s.
  useEffect(() => {
    if (!isMonitoring) return;
    const id = window.setInterval(() => {
      simRef.current = nextSample({ ...simRef.current, fault: faultRef.current });
      const window = simRef.current.samples;
      setSamples(window);

      const latest = window[window.length - 1];
      const verdict = deriveVerdict(latest);

      // Fire an incident when risk is HIGH and nothing is open.
      const cooldown = cooldownRef.current;
      if (!episodeRef.current && !cooldown && verdict.failureProbability >= 0.72) {
        const rca: RootCause = deriveRootCause(latest, faultRef.current, verdict);
        const options = recommendActions(latest, verdict, permissions);
        const healthScore = healthScoreFrom(latest, verdict.failureProbability);
        const incident: Incident = {
          id: `inc-${Date.now()}`,
          systemId: "primary",
          systemName: "Primary Device",
          detectedAt: Date.now(),
          status: "OPEN",
          failureProbability: verdict.failureProbability,
          anomalyScore: verdict.anomalyScore,
          risk: riskFromProbability(verdict.failureProbability),
          rootCause: rca,
          preFixMetrics: latest,
          scenarioKey: faultRef.current === "none" ? "resource_pressure" : faultRef.current,
        };
        const ep: ActiveEpisode = { incident, options, preFix: latest, verdict };
        episodeRef.current = ep;
        setEpisode(ep);
        cooldownRef.current = true;
        window.setTimeout(() => (cooldownRef.current = false), 30000);
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [isMonitoring, permissions]);

  // Persist telemetry + incidents to Convex (best-effort).
  const persist = useCallback(
    async (args: {
      current: TelemetrySample;
      verdict: AiVerdict;
      incident?: Incident | null;
      audit?: { actor: string; action: string; decision: string; reason: string } | null;
      agentOnline: boolean;
    }) => {
      if (!deviceId || !isAuthenticated) return;
      try {
        const { current, verdict, incident, audit, agentOnline } = args;
        await ingest({
          deviceId,
          status: statusFromScore(healthScoreFrom(current, verdict.failureProbability)),
          healthScore: healthScoreFrom(current, verdict.failureProbability),
          failureRisk: verdict.failureProbability,
          anomalyScore: verdict.anomalyScore,
          agentOnline,
          samples: simRef.current.samples.slice(-40),
          incident: incident
            ? {
                detectedAt: incident.detectedAt,
                resolvedAt: incident.resolvedAt ?? undefined,
                status: incident.status,
                failureProbability: incident.failureProbability,
                anomalyScore: incident.anomalyScore,
                risk: incident.risk,
                rootCauseId: incident.rootCause.id,
                primaryCause: incident.rootCause.primaryCause,
                explanation: incident.rootCause.explanation,
                shap: incident.rootCause.shap,
                logEvidence: incident.rootCause.logEvidence,
                mode: incident.mode,
                playbookName: incident.playbookName,
                policyDecision: incident.policyDecision,
                executedBy: incident.executedBy,
                isHealthRestored: incident.isHealthRestored,
                soakSeconds: incident.soakSeconds,
                scenarioKey: incident.scenarioKey,
              }
            : undefined,
          audit: audit
            ? {
                timestamp: Date.now(),
                actor: audit.actor,
                action: audit.action,
                decision: audit.decision,
                reason: audit.reason,
              }
            : undefined,
        });
      } catch (err) {
        console.warn("Telemetry sync failed (continuing):", err);
      }
    },
    [deviceId, isAuthenticated, ingest],
  );

  // Periodic sync of the live window.
  useEffect(() => {
    if (!deviceId) return;
    const id = window.setInterval(() => {
      const window_ = simRef.current.samples;
      const latest = window_[window_.length - 1];
      if (!latest) return;
      const verdict = deriveVerdict(latest);
      void persist({ current: latest, verdict, agentOnline: true });
    }, 12000);
    return () => window.clearInterval(id);
  }, [deviceId, persist]);

  const current = samples[samples.length - 1] ?? baselineSample();
  const verdict = useMemo(() => deriveVerdict(current), [current]);
  const healthScore = healthScoreFrom(current, verdict.failureProbability);
  const status = statusFromScore(healthScore);

  const injectFault = useCallback((f: FaultKey) => {
    faultRef.current = f;
    setFault(f);
    setValidation(null);
  }, []);

  const clearFault = useCallback(() => {
    faultRef.current = "none";
    setFault("none");
  }, []);

  const dismissEpisode = useCallback(() => {
    episodeRef.current = null;
    setEpisode(null);
  }, []);

  /** Runs the policy engine, executes the playbook, validates telemetry. */
  const executeAutomated = useCallback(
    async (option: RecoveryOption) => {
      const ep = episodeRef.current;
      if (!ep || isExecuting) return;

      setIsExecuting(true);
      setExecutionLog([`$ fixai execute ${option.id}`, "Policy engine evaluating action…"]);

      const permission = getPermissionFor(permissions, option.id);
      const result = evaluatePolicy({
        playbook: option,
        verdict: ep.verdict,
        executionsToday: 0,
        permission,
        userConfirmed: true,
      });

      const log: string[] = [
        ...[``],
        `Risk tier: ${option.riskTier} · decision: ${result.decision}`,
        `Reason: ${result.reason}`,
      ];

      if (!result.allowed) {
        setExecutionLog([
          `$ fixai execute ${option.id}`,
          "Policy engine evaluating action…",
          ...log,
          "Execution refused. Use the manual guide instead.",
        ]);
        setIsExecuting(false);
        const updated: Incident = {
          ...ep.incident,
          status: "PENDING_APPROVAL",
          policyDecision: result.decision,
          policyReason: result.reason,
        };
        episodeRef.current = { ...ep, incident: updated };
        setEpisode({ ...episodeRef.current });
        void persist({
          current: ep.preFix,
          verdict: ep.verdict,
          incident: updated,
          audit: {
            actor: "POLICY_ENGINE",
            action: `Automated ${option.name}`,
            decision: result.decision,
            reason: result.reason,
          },
          agentOnline: true,
        });
        return;
      }

      // Guarded execution with staged terminal output.
      setExecutionLog([
        `$ fixai execute ${option.id}`,
        "Policy engine evaluating action…",
        ...log,
        `Pre-repair checkpoint created (rollback ready)`,
        `Executing: ${option.command}`,
      ]);
      await new Promise((r) => window.setTimeout(r, 1600));
      setExecutionLog((prev) => [...prev, "Action applied. Soaking for 15s…"]);
      await new Promise((r) => window.setTimeout(r, 2400));

      // Recovery: pull telemetry back toward baseline.
      simRef.current = {
        ...simRef.current,
        samples: simRef.current.samples.map((s, i, arr) =>
          i >= arr.length - 3 ? { ...baselineSample(), t: s.t } : s,
        ),
      };
      faultRef.current = "none";
      setFault("none");

      const post = baselineSample();
      const postVerdict = deriveVerdict(post);
      const restored = postVerdict.failureProbability < 0.5;

      setExecutionLog((prev) => [
        ...prev,
        `Post-fix RAM ${post.ram.toFixed(0)}% · CPU ${post.cpu.toFixed(0)}% · latency ${Math.round(post.latency)}ms`,
        restored ? "Validation PASSED — health restored ✓" : "Validation FAILED — escalating…",
      ]);

      const resolved: Incident = {
        ...ep.incident,
        status: restored ? "RESOLVED" : "ESCALATED",
        resolvedAt: restored ? Date.now() : undefined,
        mode: "AUTOMATED",
        playbookName: option.name,
        policyDecision: result.decision,
        policyReason: result.reason,
        executedBy: "AUTO_AGENT",
        isHealthRestored: restored,
        soakSeconds: 15,
        postFixMetrics: post,
      };

      setValidation({ restored, pre: ep.preFix, post });
      episodeRef.current = null;
      setEpisode(null);
      setIsExecuting(false);
      persistedRef.current = true;

      void persist({
        current: post,
        verdict: postVerdict,
        incident: resolved,
        audit: {
          actor: "AUTO_AGENT",
          action: `Executed ${option.name}`,
          decision: "EXECUTED",
          reason: restored
            ? "Post-fix telemetry verified within baseline."
            : "Post-fix validation failed; escalated to manual.",
        },
        agentOnline: true,
      });
    },
    [isExecuting, permissions, persist],
  );

  /** Marks the manual guide as followed and validates telemetry. */
  const completeManualFix = useCallback(async () => {
    const ep = episodeRef.current;
    if (!ep) return;

    simRef.current = {
      ...simRef.current,
      samples: simRef.current.samples.map((s, i, arr) =>
        i >= arr.length - 3 ? { ...baselineSample(), t: s.t } : s,
      ),
    };
    faultRef.current = "none";
    setFault("none");

    const post = baselineSample();
    const postVerdict = deriveVerdict(post);
    const restored = postVerdict.failureProbability < 0.5;
    const resolved: Incident = {
      ...ep.incident,
      status: restored ? "RESOLVED" : "ESCALATED",
      resolvedAt: restored ? Date.now() : undefined,
      mode: "MANUAL",
      playbookName: "Operator-guided remediation",
      executedBy: "USER",
      isHealthRestored: restored,
      soakSeconds: 15,
      postFixMetrics: post,
    };

    setValidation({ restored, pre: ep.preFix, post });
    episodeRef.current = null;
    setEpisode(null);

    void persist({
      current: post,
      verdict: postVerdict,
      incident: resolved,
      audit: {
        actor: "USER",
        action: "Manual recovery completed",
        decision: "VALIDATED",
        reason: restored
          ? "Operator followed the guided steps; telemetry verified."
          : "Manual recovery did not restore baseline; escalated.",
      },
      agentOnline: true,
    });
  }, [persist]);

  return {
    current,
    samples,
    verdict,
    healthScore,
    status,
    fault,
    isMonitoring,
    episode,
    executionLog,
    isExecuting,
    validationResult: validation,
    injectFault,
    clearFault,
    setMonitoring,
    dismissEpisode,
    executeAutomated,
    completeManualFix,
  };
}
