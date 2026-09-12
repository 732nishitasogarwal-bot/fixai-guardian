<div align="center">

# 🔮 FixAI

### AI-Driven Intelligent Failure Prediction, Diagnosis, Guided Recovery & Permission-Aware Self-Healing System

[![React](https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript_5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](#)
[![Convex](https://img.shields.io/badge/Convex_DB-E85D75?style=flat-square&logo=convex&logoColor=white)](#)
[![Vite](https://img.shields.io/badge/Vite_7-646CFF?style=flat-square&logo=vite&logoColor=white)](#)
[![Recharts](https://img.shields.io/badge/Recharts-FF6384?style=flat-square&logo=react&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](#)

**FixAI eliminates manual debugging by continuously streaming application telemetry, predicting failures minutes ahead, explaining root causes in plain English via SHAP-style attributions, and executing permission-gated recovery playbooks with post-fix validation — all in a single closed healing loop.**

[Live Demo](/demo) · [Dashboard](/dashboard) · [Architecture](#-architecture) · [Quick Start](#-quick-start)

</div>

---

## 🧠 What is FixAI?

Modern software deployments suffer from prolonged downtime due to reactive alerting and manual diagnosis. FixAI bridges the gap between **predictive AI** and **guarded agentic execution**:

```
Telemetry Stream → Anomaly Detection → Failure Prediction → Root Cause Analysis
    → XAI Explanation → Dual Recovery (Manual / Automated) → Policy Gate
    → Guarded Execution → Telemetry Validation → Incident Memory Update
```

FixAI runs entirely in the browser for the demo — no CSV uploads, no backend setup, no 3 a.m. firefighting. The full closed loop is demonstrable with one click.

---

## 🏗️ Architecture

### High-Level Pipeline

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│  Live Telemetry  │───▶│  AI Analytics     │───▶│  Recovery Engine     │
│  (CPU/RAM/Lat/   │    │  Anomaly Score    │    │  Manual Guide        │
│   Error/Disk)    │    │  P(Failure)       │    │  Auto Execution      │
│                  │    │  SHAP Attribution │    │  Policy Gate         │
└─────────────────┘    │  Root Cause       │    │  Post-Fix Validation │
                       └──────────────────┘    └─────────────────────┘
                                │                         │
                                ▼                         ▼
                       ┌──────────────────┐    ┌─────────────────────┐
                       │  Explanation      │    │  Incident Memory     │
                       │  Engine           │    │  (Persistence +      │
                       │  Plain English    │    │   Audit Trail)       │
                       └──────────────────┘    └─────────────────────┘
```

### Module Breakdown

| Layer | Module | Technology |
|-------|--------|------------|
| **UI** | Dashboard, Charts, Modals | React 19 + TypeScript + Tailwind CSS + Recharts |
| **Telemetry** | Streaming simulation engine | TypeScript (Isolation Forest + XGBoost stand-ins) |
| **Anomaly Detection** | Isolation Forest scoring | Composite stress distance model |
| **Failure Prediction** | XGBoost P(failure) | Cost-sensitive logistic model |
| **Root Cause Analysis** | SHAP-style attribution | Signed feature weight decomposition |
| **Explanation** | Template-based NLG | Metric-driven diagnostic text generation |
| **Recovery** | Dual-mode (Manual + Automated) | Step-by-step guides + allowlisted playbooks |
| **Policy Engine** | Risk-tiered permission gating | LOW/MEDIUM/HIGH tiers with rate limits |
| **Validation** | Post-fix telemetry soak | Pre/post metric comparison |
| **Persistence** | Incidents, Audit, Device sync | Convex (serverless DB) |
| **Auth** | JWT-based with roles | Convex Auth |

---

## 🎯 Core Features

### 1. Predictive Failure Detection
- **Isolation Forest** anomaly scoring on a 5-metric feature vector
- **XGBoost** classifier predicts P(failure) over a 5-minute lead window
- Risk classified as LOW / MEDIUM / HIGH with confidence bands

### 2. Explainable Root Cause Analysis
- **SHAP-style feature attributions** rank exactly which metric drives risk upward
- **Log evidence fusion** correlates metric spikes with matching error patterns
- Primary cause identified and prioritized

### 3. Dual Recovery Modes
- **Manual Guide**: Step-by-step remediation playbook with copyable terminal commands
- **Automated Execution**: One-click execution of allowlisted playbooks with terminal-style progress output

### 4. Permission-Aware Execution
- **LOW risk** (cache flush, retry): Auto-approve under rate limits
- **MEDIUM risk** (restart container): Requires explicit user confirmation
- **HIGH risk** (schema change, config delete): Hard-blocked, recommendation only

### 5. Closed-Loop Validation
- **15-second soak period** after every fix
- Pre-fix vs post-fix metric comparison proves recovery
- Failed validation escalates to manual intervention

### 6. 6 Injectable Fault Scenarios

| Fault | Description |
|-------|-------------|
| 🔥 **CPU Spike** | Infinite loop pegs CPU, starves request handling |
| 💾 **Memory Exhaustion** | Buffer overflow; RAM climbs until OOM-kill |
| 📀 **Disk Space Fill** | Temp artifacts accumulate to 98% |
| ⏱️ **Latency Storm** | Blocking call saturates connection pool |
| ❌ **Error Burst** | Unhandled exceptions on 50% of API calls |
| 🗄️ **DB Disconnect** | Connection pool exhausts; Postgres times out |

---

## 🖥️ Pages & Screens

| Route | Description |
|-------|-------------|
| `/` | Landing page — hero, pipeline visualization, feature grid, CTAs |
| `/auth` | Registration & login (Convex Auth) |
| `/dashboard` | Overview — health score, risk gauge, live metric cards, streaming charts |
| `/dashboard/monitor` | Real-time Recharts streams + fault injection controls |
| `/dashboard/incidents` | Open incidents with RCA drawer (SHAP bars, explanation, log evidence) |
| `/dashboard/recovery` | Dual-mode recovery — manual guide + automated execution + validation |
| `/dashboard/history` | Resolved incidents and full audit trail |
| `/dashboard/permissions` | Risk-tier playbook matrix with toggle controls |
| `/demo` | **No-signup demo** — full agent runs in-browser, cloud sync on sign-in |

---

## ⚡ Quick Start

### Option 1: Live Demo (No Setup)

Click **[Try the live demo](/demo)** to run the complete FixAI system in your browser — no account, no installation.

1. Navigate to **Monitor** → click any fault injection button (CPU Spike, Memory Leak, etc.)
2. Watch the risk gauge climb → incident fires → RCA drawer opens
3. Go to **Recovery** → choose Manual Guide or Automated Execution
4. Observe the telemetry validation proving the fix worked

### Option 2: Full Account Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/fixai.git
cd fixai

# 2. Install dependencies
bun install

# 3. Configure Convex (first time only)
bunx convex dev

# 4. Start the dev server
bun run dev
```

Open `http://localhost:5173` and create an account.

### Option 3: Run Fault Injection Script (Terminal Demo)

```bash
# Simulate a CPU spike for 60 seconds (safe, self-terminating)
python scripts/simulate_fault.py --fault cpu --duration 60

# Simulate a memory leak
python scripts/simulate_fault.py --fault memory --duration 60

# Simulate disk fill (creates + cleans temp files)
python scripts/simulate_fault.py --fault disk --duration 30
```

---

## 🔬 AI/ML Methodology

### Anomaly Detection (Isolation Forest Stand-in)
- **Features**: cpu, ram, latency, errorRate, disk
- **Method**: Composite stress distance from healthy baseline
- **Output**: Normalised anomaly score ∈ [0, 1]
- **No labeled data required** — unsupervised scoring

### Failure Prediction (XGBoost Stand-in)
- **Target**: P(Failure in next 5 min) ∈ [0, 1]
- **Method**: Cost-sensitive logistic model with learned feature weights
- **Cost function**: `Operational Cost = 10 × FP + 500 × FN`
- **Threshold**: HIGH risk at P(failure) ≥ 0.75

### Root Cause Analysis (SHAP Stand-in)
- **Method**: Signed feature attribution weights
- **Formula**: `attribution_i = (value_i - baseline_i) × weight_i`
- **Output**: Ranked attributions showing which metric drives risk
- **Fused with**: Log keyword extraction (OOMKilled, ConnectionRefused, Timeout, etc.)

### Explanation Engine
- Template-based NLG mapping metric states + SHAP attributions to plain English
- Format: `"The service is at high risk because {metric} ({value}%) exceeded safe thresholds"`

---

## 🛡️ Safety Rules (Non-Negotiable)

1. **Allowlisted Playbooks Only** — The executor runs ONLY pre-audited playbooks. The AI engine passes `playbook_id` + typed parameters — never raw shell strings.
2. **Static Verification** — Destructive patterns (rm -rf, DROP TABLE, eval) are blocked at code level.
3. **Rate Limiting** — Max 3 automated actions per playbook per day.
4. **Risk-Tiered Gating** — LOW auto-approves, MEDIUM needs confirmation, HIGH is hard-blocked.
5. **Audit Trail** — Every permission decision, execution, and validation is logged.
6. **Pre-fix Snapshot** — Every automated action creates a checkpoint; failed validation can be rolled back.

---

## 📁 Project Structure

```
src/
├── main.tsx                          # App root with routing + providers
├── index.css                         # Tailwind + theme tokens
│
├── lib/
│   ├── types.ts                      # Domain model TypeScript interfaces
│   ├── telemetry.ts                  # Simulation engine + AI analytics
│   ├── playbooks.ts                  # Recovery playbook registry
│   └── policy.ts                     # Risk-tier permission engine
│
├── hooks/
│   ├── use-fixai-agent.ts            # Closed healing loop state machine
│   ├── use-auth.ts                   # Auth state management
│   └── use-agent-context.ts          # Router outlet context
│
├── convex/
│   ├── schema.ts                     # Database schema (devices, telemetry, incidents, audit)
│   ├── devices.ts                    # Device sync + telemetry ingestion
│   ├── history.ts                    # Incident + audit queries
│   └── permissions.ts                # Permission CRUD
│
├── pages/
│   ├── Landing.tsx                   # Product landing page
│   ├── Auth.tsx                      # Login / register
│   ├── Dashboard.tsx                 # Overview (health, charts, risk)
│   ├── Monitor.tsx                   # Live streaming charts + fault injection
│   ├── Incidents.tsx                 # Incident list + RCA drawer
│   ├── Recovery.tsx                  # Dual-mode recovery + validation
│   ├── History.tsx                   # Audit log + resolved incidents
│   ├── Permissions.tsx               # Risk-tier matrix editor
│   └── NotFound.tsx                  # 404 page
│
├── components/
│   ├── fixai/                        # FixAI-specific components
│   │   ├── AppShell.tsx              # Dashboard layout + sidebar
│   │   ├── MetricCard.tsx            # Telemetry metric display card
│   │   ├── RiskGauge.tsx             # Animated failure risk gauge
│   │   ├── PipelineFlow.tsx          # 8-stage pipeline visualization
│   │   ├── badges.tsx                # Status + risk-tier badges
│   │   └── EmptyState.tsx            # Empty state placeholder
│   │
│   └── ui/                           # shadcn/ui primitives
│       ├── button.tsx, card.tsx, dialog.tsx, table.tsx, ...
│
└── assets/
    └── logo.svg
```

---

## 🎨 Design System

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | Teal 500 | Accent color, buttons, highlights |
| `--background` | Zinc 950 | Dark neutral background |
| `--card` | Zinc 900 / Zinc 925 | Layered card surfaces |
| `--border` | Zinc 700–800 | Subtle dividers |
| `--ring` | Teal 500/40 | Focus states |
| `--radius` | 0.625rem | Rounded corners |

**Design principles**: Crisp typography, quiet neutrals, refined teal accent, soft layered cards, balanced contemporary spacing. Motion via Framer Motion.

---

## 📊 Benchmark Targets

| Metric | Traditional Alerting | FixAI Target |
|--------|---------------------|--------------|
| Mean Time to Detect (MTTD) | 5.0 minutes | < 10 seconds |
| Mean Time to Recover (MTTR) | 25.0 minutes | < 12 seconds |
| False Positive Rate | 18% | < 3% |
| Unauthorized Actions | Unchecked | 0% (100% AST blocked) |
| Post-Fix Verification | Manual check | 100% automated |

---

## 🔧 Technology Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19 + TypeScript + Tailwind CSS 4 |
| Charts | Recharts |
| UI Components | shadcn/ui (Radix primitives) |
| Animation | Framer Motion |
| Backend / DB | Convex (serverless) |
| Auth | Convex Auth |
| Build Tool | Vite 7 |
| Package Manager | Bun |

---

## 🚀 Future Work

- [ ] Python FastAPI backend with PostgreSQL + pgvector for production deployment
- [ ] Local agent with psutil for real hardware monitoring
- [ ] XGBoost + scikit-learn model training pipeline
- [ ] SHAP TreeExplainer for true model-agnostic explanations
- [ ] Docker Compose deployment (backend + frontend + testbed)
- [ ] WebSocket live telemetry streaming
- [ ] OpenTelemetry / Prometheus integration
- [ ] Docker container restart / cache flush playbooks
- [ ] Multi-device fleet management

---

## 📄 License

MIT

---

<div align="center">

**FixAI** — Your system heals itself *before it breaks*.

Built for the B.Tech Final Year Project: *AI-Driven Intelligent Failure Prediction, Diagnosis, Guided Recovery & Permission-Aware Self-Healing System*

</div>
