import { httpRouter } from "convex/server";
import { auth } from "./auth";
import {
  agentIngest,
  agentResolve,
  agentPendingActions,
  agentClaimAction,
} from "./agentBridge";

const http = httpRouter();

// Convex Auth routes (login, register, etc.)
auth.addHttpRoutes(http);

// Agent bridge routes (Python local agent → Convex)
http.route({
  path: "/api/v1/agent/ingest",
  method: "POST",
  handler: agentIngest,
});

http.route({
  path: "/api/v1/agent/resolve",
  method: "POST",
  handler: agentResolve,
});

http.route({
  path: "/api/v1/agent/pending-actions",
  method: "GET",
  handler: agentPendingActions,
});

http.route({
  path: "/api/v1/agent/claim-action",
  method: "POST",
  handler: agentClaimAction,
});

export default http;
