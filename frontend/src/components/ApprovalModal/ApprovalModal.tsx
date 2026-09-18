import { AlertTriangle, Check, FileUp, ShieldCheck, X } from "lucide-react";
import type { ValidationResult, WorkflowDetail } from "@/types";
import { DOC_LABELS } from "@/types";
import { fmtConfidence } from "@/utils/format";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";

export type Decision = { approval?: boolean; acknowledge?: boolean };

interface ApprovalModalProps {
  detail: WorkflowDetail | null;
  /** `review` = warning gate (acknowledge / go back); `approval` = final consent. */
  variant: "review" | "approval";
  open: boolean;
  busy: boolean;
  onDecision: (decision: Decision) => void;
  onOpenChange: (open: boolean) => void;
}

function checklist(detail: WorkflowDetail) {
  const validation: ValidationResult | null = detail.validation ?? null;
  const documentState = detail.states.find((s) => s.type === "document_required");
  const required = documentState?.required_documents ?? [];
  const docsOk = required.length === 0 || required.every((d) => detail.collected_documents.includes(d));
  const automatic = detail.states.filter((s) => s.type === "automatic");
  const eligibilityOk = automatic.length > 0 && automatic.every((s) => s.status === "completed");
  return [
    {
      label: "Eligibility",
      ok: eligibilityOk,
      detail: eligibilityOk ? "passed" : "not evaluated",
    },
    {
      label: "Required documents",
      ok: docsOk,
      detail: `${detail.collected_documents.length}/${required.length || detail.collected_documents.length} received`,
    },
    {
      label: "Cross-document validation",
      ok: validation ? validation.status === "pass" : false,
      warn: validation?.status === "needs_review",
      detail: validation ? `${validation.status.replace("_", " ")} · ${fmtConfidence(validation.confidence)}` : "not run",
    },
  ];
}

export function ApprovalModal({ detail, variant, open, busy, onDecision, onOpenChange }: ApprovalModalProps) {
  if (!detail) return null;
  const isReview = variant === "review";
  const issue = detail.validation?.issues[0];
  const active = detail.states.find((s) => s.id === detail.current_state);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="p-6 pb-4">
          <div className="flex items-center gap-2">
            <Badge tone={isReview ? "warn" : "brand"} dot pulse>
              {isReview ? "Review gate" : "Approval gate"}
            </Badge>
            {active && <span className="font-mono text-[10px] text-ink-400">{active.id}</span>}
          </div>
          <DialogTitle className="mt-3 font-display text-[28px] leading-[1.1] text-ink-950">
            {isReview ? "A warning needs your call." : "Approve the submission?"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-[13px] leading-relaxed text-ink-500">
            {isReview
              ? "Cross-document validation flagged an issue. You can accept the risk and continue, or go back and upload a corrected document."
              : "This is the final human approval gate. Nothing is submitted without your explicit consent — the executor refuses to run without it."}
          </DialogDescription>
        </div>

        <ul className="mx-6 divide-y divide-line overflow-hidden rounded-xl border border-line bg-canvas/50">
          {checklist(detail).map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className="flex items-center gap-2.5 text-[13px] text-ink-900">
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded-full",
                    item.ok ? "bg-ok-500 text-white" : item.warn ? "bg-warn-500 text-white" : "border border-line-strong bg-surface text-ink-400",
                  )}
                >
                  {item.ok ? <Check size={11} strokeWidth={3} /> : item.warn ? <AlertTriangle size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                </span>
                {item.label}
              </span>
              <span className={cn("font-mono text-[10.5px]", item.ok ? "text-ok-600" : item.warn ? "text-warn-600" : "text-ink-400")}>
                {item.detail}
              </span>
            </li>
          ))}
        </ul>

        <div className="px-6 pt-3">
          {isReview && issue ? (
            <div className="rounded-xl border border-warn-100 bg-warn-50/70 p-3.5">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-warn-600" />
                <code className="font-mono text-[11px] font-semibold text-ink-900">{issue.field}</code>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-900">{issue.message}</p>
              {issue.evidence?.length ? (
                <p className="mt-1.5 font-mono text-[11px] text-warn-600">evidence: “{issue.evidence.join(" · ")}”</p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-ok-100 bg-ok-50/70 p-3.5">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok-600" />
              <p className="text-[13px] leading-relaxed text-ink-900">
                {detail.collected_documents.length
                  ? `${detail.collected_documents.map((d) => DOC_LABELS[d] ?? d).join(", ")} verified. `
                  : ""}
                Validation {detail.validation?.status === "pass" ? "passed" : "acknowledged"}
                {detail.validation ? ` with ${fmtConfidence(detail.validation.confidence)} AI confidence.` : "."}{" "}
                Submission is simulated in demo mode.
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line bg-canvas/40 px-6 py-4 sm:flex-row sm:justify-end">
          {isReview ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => onDecision({ acknowledge: false })}>
                <FileUp size={14} /> Upload corrected document
              </Button>
              <Button variant="dark" loading={busy} onClick={() => onDecision({ acknowledge: true })}>
                Acknowledge and continue
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger" disabled={busy} onClick={() => onDecision({ approval: false })}>
                Reject
              </Button>
              <Button variant="primary" loading={busy} onClick={() => onDecision({ approval: true })}>
                <Check size={15} strokeWidth={2.5} /> Approve & submit
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
