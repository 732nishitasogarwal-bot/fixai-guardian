import { PipelineFlow } from "@/components/fixai/PipelineFlow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  Gauge,
  HeartPulse,
  ListChecks,
  Lock,
  MemoryStick,
  Radar,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Wand2,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router";

const FEATURES = [
  {
    icon: Radar,
    title: "Predictive failure detection",
    body: "Isolation-Forest anomaly scoring plus gradient-boosted P(failure) over a 5-minute lead window — before the crash, not after.",
  },
  {
    icon: Stethoscope,
    title: "Explainable root cause",
    body: "SHAP-style feature attributions rank exactly which metric is driving risk, fused with the matching log evidence.",
  },
  {
    icon: Wand2,
    title: "Dual recovery modes",
    body: "Follow a step-by-step manual guide, or let the agent execute an allowlisted playbook with your one-click approval.",
  },
  {
    icon: Lock,
    title: "Permission-aware execution",
    body: "LOW risk actions auto-run under rate limits. MEDIUM needs your approval. HIGH risk is hard-blocked from automation.",
  },
  {
    icon: CheckCircle2,
    title: "Closed-loop validation",
    body: "Every fix ends with a telemetry soak test comparing pre-fix vs post-fix metrics to prove the system actually recovered.",
  },
  {
    icon: BrainCircuit,
    title: "Incident memory",
    body: "Resolved episodes feed the vector store so the next identical fault ranks its proven fix first.",
  },
];

const STACK = [
  { icon: Activity, label: "Live telemetry (no CSV)" },
  { icon: Gauge, label: "Risk-tiered policy engine" },
  { icon: Terminal, label: "Allowlisted playbooks" },
  { icon: Database, label: "Incident memory store" },
];

export default function Landing() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const primaryHref = isAuthenticated ? "/dashboard" : "/auth";
  const primaryLabel = isAuthenticated ? "Open dashboard" : "Start monitoring";

  return (
    <div className="min-h-screen bg-background">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-soft">
              <HeartPulse className="size-4.5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Fix<span className="text-primary">AI</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {[
              { href: "#pipeline", label: "How it works" },
              { href: "#features", label: "Capabilities" },
              { href: "#stack", label: "Platform" },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to={primaryHref}>{isAuthenticated ? "Dashboard" : "Sign in"}</Link>
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <Link to={primaryHref}>
                {primaryLabel}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28 sm:pb-24">
          <div className="mx-auto max-w-3xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3.5 py-1.5 text-xs font-medium text-primary"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              Agentic telemetry · Predict · Diagnose · Heal
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className="text-4xl font-bold tracking-tight text-balance sm:text-6xl"
            >
              Your system heals itself{" "}
              <span className="text-gradient">before it breaks</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.16 }}
              className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg"
            >
              FixAI streams your device telemetry in real time, predicts failures
              minutes ahead, explains the root cause in plain English, and
              recovers with permission-gated playbooks — then proves the fix
              worked. No CSV uploads. No 3&nbsp;a.m. firefighting.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.24 }}
              className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Button
                size="lg"
                className="h-11 gap-2 px-6 shadow-soft-lg"
                onClick={() => navigate(primaryHref)}
                disabled={isLoading}
              >
                {primaryLabel}
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 gap-2 px-6"
                onClick={() => navigate("/demo")}
              >
                <Zap className="size-4" />
                Try the live demo
              </Button>
            </motion.div>
            <p className="mt-4 text-xs text-muted-foreground">
              Free demo · No credit card · Runs entirely in your browser
            </p>
          </div>

          {/* Hero dashboard preview */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="relative mx-auto mt-14 max-w-4xl"
          >
            <div className="absolute -inset-6 rounded-3xl bg-gradient-to-b from-primary/10 to-transparent blur-2xl" />
            <Card className="relative overflow-hidden border-border/70 shadow-soft-lg">
              <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3">
                <span className="size-2.5 rounded-full bg-red-400/80" />
                <span className="size-2.5 rounded-full bg-amber-400/80" />
                <span className="size-2.5 rounded-full bg-emerald-400/80" />
                <span className="ml-3 text-xs font-medium text-muted-foreground">
                  FixAI · Live healing console
                </span>
              </div>
              <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Cpu className="size-3.5 text-primary" /> CPU
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">26<span className="text-sm text-muted-foreground">%</span></p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[26%] rounded-full bg-primary" />
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <MemoryStick className="size-3.5 text-primary" /> Memory
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">44<span className="text-sm text-muted-foreground">%</span></p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[44%] rounded-full bg-primary" />
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Policy engine
                  </div>
                  <p className="mt-2 text-sm leading-snug font-medium">
                    Cache flush auto-approved
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    LOW risk · confidence 0.94 · 2/5 today
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* ── Pipeline ────────────────────────────────────────────────────── */}
      <section id="pipeline" className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              One closed loop, zero manual toil
            </h2>
            <p className="mt-3 text-muted-foreground">
              From raw telemetry to verified recovery — every stage automated,
              every risky action gated by policy.
            </p>
          </div>
          <div className="mt-10">
            <PipelineFlow />
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Monitoring that acts, not just alerts
          </h2>
          <p className="mt-3 text-muted-foreground">
            Traditional tools page you after the outage. FixAI closes the loop
            from prediction to proof of recovery.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.06 }}
            >
              <Card className="h-full border-border/70 shadow-soft transition-shadow hover:shadow-soft-lg">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <f.icon className="size-5" />
                  </div>
                  <h3 className="font-semibold tracking-tight">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Demo strip ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <Card className="overflow-hidden border-border/70 shadow-soft-lg">
          <CardContent className="grid gap-8 p-8 sm:p-10 lg:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                <BellRing className="size-3" /> Try every failure scenario
              </div>
              <h3 className="mt-4 text-2xl font-bold tracking-tight">
                Break it in the demo. Watch it heal.
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Inject CPU spikes, memory leaks, disk fills, latency storms and
                database dropouts into a simulated device. FixAI detects the
                anomaly, predicts the crash, explains the cause, and walks you
                through recovery — manual or automated, your call.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {[
                  "6 injectable fault scenarios",
                  "Live risk gauge with prediction lead time",
                  "SHAP attribution bars per incident",
                  "Pre/post-fix validation proof",
                ].map((li) => (
                  <li key={li} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-muted-foreground">{li}</span>
                  </li>
                ))}
              </ul>
              <Button className="mt-7 gap-2" onClick={() => navigate("/demo")}>
                Open the live demo <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 self-center">
              {STACK.map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-border/60 bg-muted/40 p-4"
                >
                  <s.icon className="size-5 text-primary" />
                  <p className="mt-2 text-xs leading-snug font-medium">{s.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-border/60">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_80%_at_50%_100%,black,transparent)]" />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Stop fighting fires. Start preventing them.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Connect your device once — the agent monitors, predicts, and heals
            in the background while you get on with your work.
          </p>
          <Button
            size="lg"
            className="mt-8 h-11 gap-2 px-7 shadow-soft-lg"
            onClick={() => navigate(primaryHref)}
          >
            {primaryLabel} <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/60">
        <div className={cn("mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 sm:flex-row sm:px-6")}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HeartPulse className="size-4 text-primary" />
            FixAI — Intelligent failure prediction & permission-aware self-healing
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link to="/dashboard" className="hover:text-foreground">Dashboard</Link>
            <Link to="/demo" className="hover:text-foreground">Live demo</Link>
            <span>© {new Date().getFullYear()} FixAI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
