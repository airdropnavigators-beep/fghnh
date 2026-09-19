import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Quote, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import type { ValidationResult } from "@/types";
import { DOC_LABELS } from "@/types";
import { fmtConfidence } from "@/utils/format";
import { cn } from "@/utils/cn";
import { Badge, type Tone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface ValidationResultsProps {
  result: ValidationResult | null;
  className?: string;
}

const STATUS: Record<
  ValidationResult["status"],
  { icon: LucideIcon; tone: Tone; title: string; body: string; ring: string; bar: string }
> = {
  pass: {
    icon: CheckCircle2,
    tone: "ok",
    title: "Cross-document validation passed",
    body: "Every extracted field satisfies the programme requirements.",
    ring: "border-ok-100",
    bar: "bg-ok-500",
  },
  needs_review: {
    icon: AlertTriangle,
    tone: "warn",
    title: "Potential eligibility issue",
    body: "One or more fields conflict with the requirements. Review the evidence before continuing.",
    ring: "border-warn-100",
    bar: "bg-warn-500",
  },
  block: {
    icon: XCircle,
    tone: "err",
    title: "Validation blocked",
    body: "Confidence is too low or a hard requirement failed. No submission will be attempted.",
    ring: "border-err-100",
    bar: "bg-err-500",
  },
};

const SEVERITY_TONE: Record<string, Tone> = { info: "neutral", warning: "warn", error: "err" };

export function ValidationResults({ result, className }: ValidationResultsProps) {
  if (!result) {
    return (
      <EmptyState
        compact
        icon={ShieldCheck}
        title="Validation hasn't run yet"
        body="Once all required documents are in, cross-document checks run here with evidence and confidence."
        className={className}
      />
    );
  }

  const s = STATUS[result.status] ?? STATUS.block;
  const Icon = s.icon;
  const pct = Math.round(result.confidence * 100);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("panel overflow-hidden", s.ring, className)}
      aria-label="Validation results"
    >
      <div className="p-5">
        <span className="eyebrow">Step · Validation</span>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border",
                s.tone === "ok" && "border-ok-100 bg-ok-50 text-ok-600",
                s.tone === "warn" && "border-warn-100 bg-warn-50 text-warn-600",
                s.tone === "err" && "border-err-100 bg-err-50 text-err-600",
              )}
            >
              <Icon size={18} />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold leading-tight text-ink-950">{s.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">{s.body}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-3xl leading-none tabular-nums text-ink-950">{fmtConfidence(result.confidence)}</p>
            <p className="eyebrow mt-1 !text-[9.5px]">AI confidence</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-line">
            <motion.span
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className={cn("absolute inset-y-0 left-0 rounded-full", s.bar)}
            />
            <span className="absolute inset-y-0 left-[60%] w-px bg-ink-400/50" title="60% — block threshold" />
            <span className="absolute inset-y-0 left-[85%] w-px bg-ink-400/50" title="85% — auto-pass threshold" />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-ink-400">
            <span>block &lt; 60%</span>
            <span>review 60–85%</span>
            <span>pass ≥ 85%</span>
          </div>
        </div>
      </div>

      {result.issues.length > 0 && (
        <ol className="space-y-2 border-t border-line bg-canvas/50 p-4">
          {result.issues.map((issue, i) => (
            <motion.li
              key={`${issue.field}-${i}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              className="rounded-xl border border-line bg-surface p-3.5 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-900">
                  {issue.field}
                </code>
                <Badge tone={SEVERITY_TONE[issue.severity] ?? "neutral"}>{issue.severity}</Badge>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-900">{issue.message}</p>
              {issue.evidence && issue.evidence.length > 0 && (
                <blockquote className="mt-2.5 flex gap-2 rounded-lg border-l-2 border-warn-500 bg-warn-50/60 px-3 py-2">
                  <Quote size={12} className="mt-0.5 shrink-0 text-warn-600" />
                  <span className="font-mono text-[11px] leading-relaxed text-ink-700">{issue.evidence.join(" · ")}</span>
                </blockquote>
              )}
              {issue.suggestion && <p className="mt-2 text-xs leading-relaxed text-ink-500">→ {issue.suggestion}</p>}
            </motion.li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-3">
        <span className="eyebrow mr-1 !text-[9.5px]">Checked</span>
        {result.checked_documents.length ? (
          result.checked_documents.map((d) => (
            <Badge key={d} tone="neutral">
              {DOC_LABELS[d] ?? d.replace(/_/g, " ")}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-ink-400">—</span>
        )}
      </div>
    </motion.section>
  );
}
