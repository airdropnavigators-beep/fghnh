import { motion } from "framer-motion";
import type { WorkflowDetail } from "@/types";
import { effectiveProgress } from "@/utils/progress";
import { cn } from "@/utils/cn";

interface ProgressBarProps {
  detail: WorkflowDetail | null;
  busy?: boolean;
  className?: string;
}

export function ProgressBar({ detail, busy, className }: ProgressBarProps) {
  const progress = effectiveProgress(detail);
  const ratio = progress?.ratio ?? 0;
  const done = detail?.status === "completed";
  const cancelled = detail?.status === "cancelled" || detail?.status === "failed";
  const steps = detail?.states.filter((s) => s.type !== "terminal") ?? [];

  return (
    <div className={cn("flex items-center gap-4 px-4 py-2.5 sm:px-6", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {steps.length > 0 ? (
          steps.map((s, i) => {
            const state =
              s.status === "completed"
                ? "done"
                : s.status === "active"
                  ? "active"
                  : s.status === "blocked" || s.status === "failed"
                    ? "err"
                    : "pending";
            return (
              <motion.span
                key={s.id}
                initial={{ scaleX: 0.6, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                title={`${s.label} · ${s.status}`}
                className={cn(
                  "relative h-1.5 flex-1 overflow-hidden rounded-full bg-line transition-colors duration-500",
                  state === "done" && "bg-brand-500",
                  state === "err" && "bg-err-500",
                  cancelled && state !== "done" && "bg-line-strong",
                )}
              >
                {state === "active" && (
                  <motion.span
                    className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-brand-500"
                    animate={{ x: ["-100%", "220%"] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
              </motion.span>
            );
          })
        ) : (
          <span className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-line" />
        )}
      </div>
      <div className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-500">
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-brand-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            working
          </span>
        ) : !progress ? (
          "—"
        ) : done ? (
          <span className="text-ok-600">complete · 100%</span>
        ) : cancelled ? (
          <span className="text-ink-500">ended · {detail?.status.replace("_", " ")}</span>
        ) : (
          `${progress.completed}/${progress.total} · ${Math.round(ratio * 100)}%`
        )}
      </div>
    </div>
  );
}
