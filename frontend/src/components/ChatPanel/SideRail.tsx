import { motion } from "framer-motion";
import { ArrowRight, Compass, type LucideIcon, Flag, ListChecks, Target, Waypoints } from "lucide-react";
import type { WorkflowDetail } from "@/types";
import { NEEDS_LABELS } from "@/types";
import { fmtConfidence } from "@/utils/format";
import { cn } from "@/utils/cn";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";

interface SideRailProps {
  detail: WorkflowDetail | null;
  loading?: boolean;
  className?: string;
}

interface Step {
  icon: LucideIcon;
  title: string;
  body: string | null;
  meta?: { label: string; tone: Tone; pulse?: boolean } | null;
  emphasis?: boolean;
}

export function SideRail({ detail, loading, className }: SideRailProps) {
  if (loading) {
    return (
      <section className={cn("panel p-5", className)} aria-busy>
        <span className="eyebrow">Run</span>
        <div className="mt-4 space-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-7 w-7 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className={cn("panel p-5", className)}>
        <span className="eyebrow">Run</span>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          Idle. Start with a goal and this rail will track the plan, the current action and what
          comes next.
        </p>
      </section>
    );
  }

  const active = detail.states.find((s) => s.id === detail.current_state);
  const nextTargets =
    active?.transitions.map((t) => ({
      id: t.target,
      label: detail.states.find((s) => s.id === t.target)?.label ?? t.target,
      condition: t.condition,
    })) ?? [];
  const steps = detail.states.filter((s) => s.type !== "terminal");
  const finished = detail.status !== "in_progress";

  const validationTone: Tone =
    detail.validation?.status === "pass" ? "ok" : detail.validation?.status === "needs_review" ? "warn" : "err";

  const items: Step[] = [
    { icon: Target, title: "Goal", body: detail.goal },
    {
      icon: Waypoints,
      title: "Workflow",
      body: `${steps.length} steps · ${detail.states.length - steps.length} outcomes`,
      meta: { label: `${detail.workflow_id.slice(0, 11)}…`, tone: "neutral" },
    },
    {
      icon: Compass,
      title: finished ? "Outcome" : "Current action",
      body: finished
        ? detail.last_message ?? (detail.status === "completed" ? "Workflow completed." : "Workflow ended.")
        : active
          ? active.label
          : "Planning…",
      meta: finished
        ? { label: detail.status.replace("_", " "), tone: detail.status === "completed" ? "ok" : "neutral" }
        : detail.needs
          ? { label: NEEDS_LABELS[detail.needs] ?? detail.needs, tone: "brand", pulse: true }
          : null,
      emphasis: true,
    },
    {
      icon: ListChecks,
      title: "Result",
      body: detail.validation
        ? `Validation ${detail.validation.status.replace("_", " ")} · ${fmtConfidence(detail.validation.confidence)} confidence`
        : detail.collected_documents.length
          ? `${detail.collected_documents.length} document${detail.collected_documents.length === 1 ? "" : "s"} received`
          : detail.last_message ?? null,
      meta: detail.validation ? { label: detail.validation.status.replace("_", " "), tone: validationTone } : null,
    },
    {
      icon: Flag,
      title: "Next state",
      body: finished ? null : nextTargets.length ? null : "—",
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("panel p-5", className)}
      aria-label="Run status"
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">Run</span>
        <Badge tone={finished ? (detail.status === "completed" ? "ok" : "neutral") : "brand"} dot pulse={!finished}>
          {finished ? detail.status.replace("_", " ") : "live"}
        </Badge>
      </div>

      <ol className="mt-4 space-y-4">
        {items.map((step, i) => {
          const Icon = step.icon;
          const last = i === items.length - 1;
          return (
            <li key={step.title} className="relative flex gap-3">
              {!last && <span className="absolute left-[13px] top-8 h-[calc(100%-14px)] w-px bg-line" aria-hidden />}
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
                  step.emphasis && !finished
                    ? "border-brand-200 bg-brand-50 text-brand-600"
                    : "border-line bg-canvas text-ink-500",
                )}
              >
                <Icon size={13} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="eyebrow !text-[10px]">{step.title}</span>
                  {step.meta && (
                    <Badge tone={step.meta.tone} dot pulse={step.meta.pulse}>
                      {step.meta.label}
                    </Badge>
                  )}
                </div>
                {step.title === "Next state" && !finished && nextTargets.length > 0 ? (
                  <ul className="mt-1.5 space-y-1">
                    {nextTargets.map((t) => (
                      <li key={t.id} className="flex items-center gap-1.5 text-[13px] text-ink-900">
                        <ArrowRight size={12} className="shrink-0 text-ink-400" />
                        <span className="font-medium">{t.label}</span>
                        <span className="truncate font-mono text-[10px] text-ink-400">{t.condition.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : step.body ? (
                  <p
                    className={cn(
                      "mt-0.5 text-[13px] leading-snug",
                      step.emphasis ? "font-semibold text-ink-950" : "text-ink-900",
                    )}
                  >
                    {step.body}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[13px] text-ink-400">—</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}
