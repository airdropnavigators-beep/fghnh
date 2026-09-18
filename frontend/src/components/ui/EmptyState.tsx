import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, body, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-canvas/60 text-center",
        compact ? "px-4 py-6" : "px-6 py-10",
        className,
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-ink-500 shadow-card">
        <Icon size={18} strokeWidth={1.75} aria-hidden />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink-900">{title}</p>
      {body && <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
