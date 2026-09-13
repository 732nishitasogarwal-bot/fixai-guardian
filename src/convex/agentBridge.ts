/**
 * FixAI — Agent Bridge HTTP Action
 *
 * Provides a public HTTP endpoint that the Python local agent can POST
 * real telemetry data to. The action authenticates via a device-level
 * API key (stored in CONVEX_DEVICE_API_KEY env var) and writes directly
 * to the Convex database.
 *
 * Endpoint: POST /api/v1/agent/ingest
 *
 * Request body:
 * {
 *   "device_name": "My Laptop",
 *   "specs": { "os": "Ubuntu 24.04", "cpuModel": "Intel i7", "cores": 8, "ramGb": 16 },
 *   "telemetry": { "cpu": 42.5, "ram": 68.1, "latency": 120, "errorRate": 0.5, "disk": 55.2 },
 *   "ai_verdict": { "anomalyScore": 0.12, "pFailure": 0.05, "risk": "LOW", "confidence": 0.92 },
 *   "shap": [
 *     { "feature": "cpu", "value": 42.5, "attribution": -0.06 },
 *     { "feature": "ram", "value": 68.1, "attribution": 0.45 }
 *   ],
 *   "incident": null | { ... },
 *   "audit": null | { ... }
 * }
 */

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * POST /api/v1/agent/ingest
 *
 * Accepts telemetry from an external Python agent and writes it to the
 * Convex database using the existing ingestTelemetry mutation.
 *
 * Authentication: X-API-Key header must match CONVEX_DEVICE_API_KEY env var.
 */
export const agentIngest = httpAction(async (ctx, request) => {
  // ── 1. Validate API key ──────────────────────────────────────────
  const apiKey = request.headers.get("X-API-Key");
  const expectedKey = process.env.CONVEX_DEVICE_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — invalid or missing X-API-Key" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── 2. Parse request body ────────────────────────────────────────
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { device_name, specs, telemetry, ai_verdict, shap, incident, audit } = body;
  if (!device_name || !specs || !telemetry || !ai_verdict) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: device_name, specs, telemetry, ai_verdict" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── 3. Find or register the device ───────────────────────────────
  // The agent bridge uses a service account — we look up by device name.
  // For MVP, we use a hardcoded service userId or find the first user.
  // In production, each agent would have its own device registration.

  let deviceId: any = null;

  // Try to find an existing device with this name
  try {
    const existing = await ctx.runQuery(api.devices.findDeviceByName, {
      name: device_name,
    });
    if (existing) {
      deviceId = existing;
    }
  } catch {
    // Query may not exist yet — that's fine
  }

  // If no device found, we need to handle the first-run case.
  // The Python agent should first register via the React dashboard,
  // which creates the device. Then the agent posts telemetry.
  if (!deviceId) {
    return new Response(
      JSON.stringify({
        error: "Device not registered. Please connect via the FixAI dashboard first.",
        hint: "Open /dashboard and click 'Connect Device' to register this machine.",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── 4. Ingest telemetry via the existing mutation ────────────────
  try {
    const result = await ctx.runMutation(api.devices.ingestTelemetry, {
      deviceId,
      status: statusFromRisk(ai_verdict.risk),
      healthScore: healthFromVerdict(ai_verdict),
      failureRisk: ai_verdict.pFailure,
      anomalyScore: ai_verdict.anomalyScore,
      agentOnline: true,
      samples: [
        {
          t: Date.now(),
          cpu: telemetry.cpu,
          ram: telemetry.ram,
          latency: telemetry.latency,
          errorRate: telemetry.errorRate,
          disk: telemetry.disk,
        },
      ],
      incident: incident || undefined,
      audit: audit || undefined,
    });

    return new Response(
      JSON.stringify({ ok: true, deviceId, result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: `Ingest failed: ${err.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * POST /api/v1/agent/resolve
 *
 * Called by the Python agent after a recovery attempt to update incident status.
 */
export const agentResolve = httpAction(async (ctx, request) => {
  const apiKey = request.headers.get("X-API-Key");
  const expectedKey = process.env.CONVEX_DEVICE_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const body = await request.json();
  const { incident_id, status, is_health_restored, mode, playbook_name, post_fix_note, soak_seconds } = body;

  if (!incident_id || !status) {
    return new Response(
      JSON.stringify({ error: "Missing incident_id or status" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    await ctx.runMutation(api.devices.resolveIncident, {
      incidentId: incident_id,
      status,
      isHealthRestored: is_health_restored ?? false,
      mode: mode ?? "AUTOMATED",
      playbookName: playbook_name ?? "Unknown",
      postFixNote: post_fix_note ?? "No details",
      soakSeconds: soak_seconds ?? 15,
    });

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: `Resolve failed: ${err.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ─── GET /api/v1/agent/pending-actions ─────────────────────────────────
// Returns incidents with OPEN or PENDING_APPROVAL status for a given device.
// The Python agent polls this endpoint to discover recovery work.
//
// Query params: ?device_name=My Laptop
// Headers:      X-API-Key: <CONVEX_DEVICE_API_KEY>
// Response:     { success: true, deviceId: "...", actions: [...] }

export const agentPendingActions = httpAction(async (ctx, request) => {
  // ── 1. Authenticate ────────────────────────────────────────────────
  if (!requireApiKey(request)) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  // ── 2. Parse device_name from query string ──────────────────────────
  const url = new URL(request.url);
  const deviceName = url.searchParams.get("device_name");
  if (!deviceName) {
    return jsonResponse(
      { success: false, error: "Missing device_name query parameter" },
      400,
    );
  }

  // ── 3. Look up the device and its pending incidents ─────────────────
  const pendingIncidents = await ctx.runQuery(
    api.devices.getPendingActionsForDevice,
    { deviceName },
  );

  if (pendingIncidents === null) {
    return jsonResponse(
      { success: false, error: "Device not found", device_name: deviceName },
      404,
    );
  }  // ── 4. Map incidents to action payloads for the Python executor ─────
  const actions = pendingIncidents.map((inc: any) => {
    // Fix #3: the canonical playbookId travels with the incident, unchanged
    // from dashboard → bridge → agent. Legacy rows (pre-catalog playbookName
    // or old dashboard ids) resolve through the shared legacy map.
    const playbookRef = inc.playbookId ?? inc.playbookName ?? undefined;
    const playbookId = playbookRef
      ? resolveLegacyPlaybookId(playbookRef)
      : causeToPlaybookId(inc.primaryCause);

    return {
      incidentId: inc._id,
      deviceId: inc.deviceId,
      status: inc.status,
      risk: inc.risk,
      playbookId,
      playbookName: inc.playbookName || inc.primaryCause,
      parameters: {}, // typed params, never raw shell
      primaryCause: inc.primaryCause,
      explanation: inc.explanation,
      requiresPermission: inc.risk !== "LOW",
      createdAt: inc.detectedAt,
      shap: inc.shap,
    };
  });

  return jsonResponse({
    success: true,
    deviceId: pendingIncidents[0]?.deviceId ?? null,
    actions,
  });
});

// ─── POST /api/v1/agent/claim-action ─────────────────────────────────────
// Atomically claims a pending action so the agent can execute it.
// Prevents duplicate execution across multiple agent poll cycles.
//
// Body:         { incident_id: "...", agent_name: "fixai-agent" }
// Headers:      X-API-Key: <CONVEX_DEVICE_API_KEY>
// Response:     { success: true, status: "EXECUTING" }
//               or { success: false, reason: "Already in status: ..." }

export const agentClaimAction = httpAction(async (ctx, request) => {
  // ── 1. Authenticate ────────────────────────────────────────────────
  if (!requireApiKey(request)) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  // ── 2. Parse body ──────────────────────────────────────────────────
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { incident_id, agent_name } = body;
  if (!incident_id || !agent_name) {
    return jsonResponse(
      {
        success: false,
        error: "Missing required fields: incident_id, agent_name",
      },
      400,
    );
  }

  // ── 3. Attempt atomic claim ────────────────────────────────────────
  try {
    const result = await ctx.runMutation(api.devices.claimIncident, {
      incidentId: incident_id,
      agentName: agent_name,
    });

    if (result.ok) {
      return jsonResponse({ success: true, status: "EXECUTING" });
    }
    return jsonResponse(
      { success: false, reason: result.reason },
      409,
    );
  } catch (err: any) {
    return jsonResponse(
      { success: false, error: `Claim failed: ${err.message}` },
      500,
    );
  }
});

// ─── Helper functions ──────────────────────────────────────────────────

// ─── Fix #3 playbook id resolution ────────────────────────────────────

/**
 * Legacy compatibility (STEP 9): incidents created before the unified
 * catalog may store old dashboard ids or display names. Resolve them to the
 * canonical agent-executable ids. Canonical ids pass through unchanged.
 */
function resolveLegacyPlaybookId(ref: string): string {
  const LEGACY: Record<string, string> = {
    restart_worker: "restart_background_service",
    restart_container: "kill_high_mem_process",
    scale_instances: "retry_service",
    purge_tmp: "purge_temp_files",
    db_maintenance: "flush_cache",
    "Restart Background Worker": "restart_background_service",
    "Restart Service Container": "kill_high_mem_process",
    "Scale Service Instances": "retry_service",
    "Purge Temporary Files": "purge_temp_files",
    "Database Maintenance Window": "flush_cache",
    "Terminate High-Memory Process": "kill_high_mem_process",
    "Retry Failed Requests": "retry_service",
    "Restart Background Service": "restart_background_service",
    "Flush Application Cache": "flush_cache",
  };
  return LEGACY[ref] ?? ref;
}

/**
 * Root-cause → playbook fallback for agent-detected incidents that were never
 * queued through the dashboard (no stored playbookId). Kept minimal and
 * aligned with the canonical catalog ids.
 */
function causeToPlaybookId(cause: string | undefined): string {
  const CAUSE_MAP: Record<string, string> = {
    "CPU Exhaustion": "kill_high_mem_process",
    "CPU Starvation": "kill_high_mem_process",
    "Memory Exhaustion": "kill_high_mem_process",
    "Storage Exhaustion": "purge_temp_files",
    "Disk I/O Saturation": "flush_cache",
    "Network Latency Degradation": "retry_service",
    "Application Error Storm": "restart_background_service",
    "Database Connection Failure": "restart_background_service",
  };
  return (cause && CAUSE_MAP[cause]) || "flush_cache";
}

function requireApiKey(request: Request): boolean {
  const apiKey = request.headers.get("X-API-Key");
  const expectedKey = process.env.CONVEX_DEVICE_API_KEY;
  return !!expectedKey && apiKey === expectedKey;
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function statusFromRisk(risk: string): "HEALTHY" | "DEGRADED" | "CRITICAL" {
  if (risk === "HIGH") return "CRITICAL";
  if (risk === "MEDIUM") return "DEGRADED";
  return "HEALTHY";
}

function healthFromVerdict(v: any): number {
  const base = (1 - v.pFailure) * 100;
  return Math.round(Math.max(0, Math.min(100, base)));
}
