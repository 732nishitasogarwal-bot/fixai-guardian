import { StatusBadge } from "@/components/fixai/badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useFixAiAgent, type FixAiAgent } from "@/hooks/use-fixai-agent";
import { cn } from "@/lib/utils";
import {
  Activity,
  ChevronDown,
  Gauge,
  HeartPulse,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Settings,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/monitor", label: "Live Monitor", icon: Activity },
  { to: "/dashboard/incidents", label: "Incidents", icon: Monitor },
  { to: "/dashboard/recovery", label: "Recovery", icon: Wrench },
  { to: "/dashboard/history", label: "History & Audit", icon: History },
  { to: "/dashboard/permissions", label: "Permissions", icon: ShieldCheck },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )
          }
        >
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <HeartPulse className="size-4.5" />
      </div>
      <span className="text-base font-semibold tracking-tight">
        Fix<span className="text-primary">AI</span>
      </span>
    </Link>
  );
}

/**
 * Layout for all authenticated FixAI routes. Owns the live agent so telemetry,
 * fault injection, and episode state persist across pages; child pages consume
 * it via `useOutletContext<FixAiAgent>()`.
 */
export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const agent: FixAiAgent = useFixAiAgent();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const displayName = user?.name || user?.email?.split("@")[0] || "Operator";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/60 bg-sidebar px-4 py-5 lg:flex">
        <div className="px-1 pb-6">
          <Brand />
        </div>
        <NavLinks />
        <div className="mt-auto space-y-3 pt-6">
          <div className="rounded-xl border border-border/60 bg-card p-3 shadow-soft">
            <p className="text-xs font-medium text-muted-foreground">Prediction engine</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              XGBoost · live
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Lead window: 5 min · gated by policy
            </p>
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={handleSignOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <div className="lg:hidden">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Open navigation">
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-4">
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <div className="pb-4">
                    <Brand />
                  </div>
                  <NavLinks onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>
            </div>

            {/* Live status summary */}
            <div className="flex min-w-0 items-center gap-2.5">
              <Gauge className="size-4 shrink-0 text-primary" />
              <StatusBadge status={agent.status} />
              <span className="hidden text-sm text-muted-foreground sm:inline">
                P(fail) {(agent.verdict.failureProbability * 100).toFixed(0)}%
              </span>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-sm font-medium tabular-nums sm:inline">
                Health {agent.healthScore}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-1.5 px-2">
                    <div className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary uppercase">
                      {displayName.slice(0, 2)}
                    </div>
                    <span className="hidden text-sm font-medium md:inline">{displayName}</span>
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {user?.email ?? "Signed in"}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/dashboard/permissions")}>
                    <Settings className="size-4" /> Permissions & risk
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet context={agent} />
        </main>
      </div>
    </div>
  );
}
