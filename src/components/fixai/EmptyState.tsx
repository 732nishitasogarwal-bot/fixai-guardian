import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-6" />
      </div>
      <p className="mt-4 font-semibold tracking-tight">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
