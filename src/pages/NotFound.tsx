import { Button } from "@/components/ui/button";
import { HeartPulse } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <HeartPulse className="size-6" />
      </div>
      <h1 className="mt-5 text-4xl font-bold tracking-tight">404</h1>
      <p className="mt-2 text-muted-foreground">
        This page couldn&apos;t be diagnosed — it doesn&apos;t exist.
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Back to FixAI</Link>
      </Button>
    </div>
  );
}
