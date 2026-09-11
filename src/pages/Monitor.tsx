import { RiskGauge } from "@/components/fixai/RiskGauge";
import { StatusBadge } from "@/components/fixai/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useAgent } from "@/hooks/use-agent-context";
import {
  computeAnomalyScore,
  FAULTS,
  type FaultKey,
} from "@/lib/telemetry";
import { Activity, Bug, Cpu, Gauge, MemoryStick, Zap } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

const TIME_FMT = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function Monitor() {
  const {
    samples,
    current,
    verdict,
    healthScore,
    status,
    fault,
    isMonitoring,
    setMonitoring,
    injectFault,
    clearFault,
  } = useAgent();

  const chartData = samples.map((s) => ({ ...s, time: TIME_FMT(s.t) }));
  const anomaly = computeAnomalyScore(current);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Monitor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rolling telemetry window · polled every 2 seconds · Isolation-Forest
            anomaly score overlay
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={isMonitoring} onCheckedChange={setMonitoring} aria-label="Toggle monitoring" />
            Streaming
          </div>
        </div>
      </div>

      {/* Current snapshot + gauge */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Current signal snapshot</CardTitle>
            <CardDescription>Latest values from the streaming window</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SnapshotRow icon={Cpu} label="CPU" value={current.cpu} unit="%" max={100} warn={65} bad={85} />
            <SnapshotRow icon={MemoryStick} label="Memory" value={current.ram} unit="%" max={100} warn={65} bad={85} />
            <SnapshotRow icon={Zap} label="Latency" value={current.latency} unit="ms" max={6000} warn={800} bad={2000} />
            <SnapshotRow
              icon={Activity}
              label="HTTP 5xx rate"
              value={current.errorRate}
              unit="%"
              max={60}
              warn={5}
              bad={18}
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col items-center justify-center gap-2 shadow-soft">
          <CardHeader className="pb-0">
            <CardTitle className="text-center text-base">Failure prediction</CardTitle>
          </CardHeader>
          <RiskGauge probability={verdict.failureProbability} tier={verdict.risk} size={190} />
          <p className="pb-4 text-xs text-muted-foreground">
            Anomaly score {anomaly.toFixed(2)} · model confidence{" "}
            {(verdict.confidence * 100).toFixed(0)}%
          </p>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">CPU & Memory</CardTitle>
            <CardDescription>Percent utilisation, 3-minute window</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                cpu: { label: "CPU %", color: "var(--chart-1)" },
                ram: { label: "Memory %", color: "var(--chart-2)" },
              }}
              className="h-56 w-full"
            >
              <AreaChart data={chartData} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-cpu)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--color-cpu)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gRam" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-ram)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-ram)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={42} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="cpu" stroke="var(--color-cpu)" fill="url(#gCpu)" strokeWidth={2} isAnimationActive={false} />
                <Area type="monotone" dataKey="ram" stroke="var(--color-ram)" fill="url(#gRam)" strokeWidth={2} isAnimationActive={false} />
                <ReferenceLine y={85} stroke="var(--color-chart-4)" strokeDasharray="4 4" />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Latency</CardTitle>
            <CardDescription>P95 response time (ms) with 2s alert line</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{ latency: { label: "Latency ms", color: "var(--chart-3)" } }}
              className="h-56 w-full"
            >
              <AreaChart data={chartData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gLat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-latency)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-latency)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={42} />
                <YAxis tickLine={false} axisLine={false} width={52} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="latency" stroke="var(--color-latency)" fill="url(#gLat)" strokeWidth={2} isAnimationActive={false} />
                <ReferenceLine y={2000} stroke="var(--color-chart-4)" strokeDasharray="4 4" />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">HTTP 5xx error rate</CardTitle>
            <CardDescription>Percent of requests failing, 18% critical line</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{ errorRate: { label: "5xx %", color: "var(--chart-4)" } }}
              className="h-56 w-full"
            >
              <LineChart data={chartData} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={42} />
                <YAxis domain={[0, 60]} tickLine={false} axisLine={false} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="errorRate" stroke="var(--color-errorRate)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <ReferenceLine y={18} stroke="var(--color-chart-4)" strokeDasharray="4 4" />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Disk usage</CardTitle>
            <CardDescription>Primary mount utilisation, 90% critical line</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{ disk: { label: "Disk %", color: "var(--chart-5)" } }}
              className="h-56 w-full"
            >
              <LineChart data={chartData} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={42} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="disk" stroke="var(--color-disk)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <ReferenceLine y={90} stroke="var(--color-chart-4)" strokeDasharray="4 4" />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Fault injection */}
      <Card className="shadow-soft">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bug className="size-4.5 text-primary" />
            <CardTitle className="text-base">Fault injection lab</CardTitle>
          </div>
          <CardDescription>
            Inject a controlled fault and watch the anomaly score and risk gauge react live.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(Object.keys(FAULTS) as Exclude<FaultKey, "none">[]).map((key) => (
            <button
              key={key}
              onClick={() => injectFault(key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                fault === key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {FAULTS[key].label}
            </button>
          ))}
          {fault !== "none" && (
            <button
              onClick={clearFault}
              className="rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              Clear fault
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SnapshotRow({
  icon: Icon,
  label,
  value,
  unit,
  max,
  warn,
  bad,
}: {
  icon: typeof Cpu;
  label: string;
  value: number;
  unit: string;
  max: number;
  warn: number;
  bad: number;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const tone =
    value >= bad ? "text-red-600 dark:text-red-400" : value >= warn ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  const barTone =
    value >= bad ? "bg-red-500" : value >= warn ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </span>
        <span className={`text-lg font-semibold tabular-nums ${tone}`}>
          {value >= 100 ? value.toFixed(0) : value.toFixed(value < 10 ? 1 : 0)}
          <span className="text-xs text-muted-foreground">{unit}</span>
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-background">
        <div className={`h-full rounded-full ${barTone} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
