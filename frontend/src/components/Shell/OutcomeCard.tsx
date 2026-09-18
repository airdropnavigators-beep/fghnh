import { motion } from "framer-motion";
import { Check, Copy, PartyPopper, RotateCcw, ScrollText, XCircle } from "lucide-react";
import { useState } from "react";
import type { WorkflowDetail } from "@/types";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";

interface OutcomeCardProps {
  detail: WorkflowDetail;
  confirmationId?: string;
  onStartOver: () => void;
  onAudit: () => void;
}

export function OutcomeCard({ detail, confirmationId, onStartOver, onAudit }: OutcomeCardProps) {
  const [copied, setCopied] = useState(false);
  const success = detail.status === "completed";
  const terminal = detail.states.find((s) => s.id === detail.current_state);

  const copy = async () => {
    if (!confirmationId) return;
    try {
      await navigator.clipboard.writeText(confirmationId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard unavailable — nothing to do
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn("panel overflow-hidden", success ? "border-ok-100" : "border-line")}
      aria-label="Workflow outcome"
    >
      <div className={cn("relative p-6", success ? "bg-[radial-gradient(120%_120%_at_100%_0%,#eefbf3_0%,#ffffff_60%)]" : "bg-canvas/60")}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-9 w-9 place-items-center rounded-xl border",
              success ? "border-ok-100 bg-ok-50 text-ok-600" : "border-line bg-surface text-ink-500",
            )}
          >
            {success ? <PartyPopper size={17} /> : <XCircle size={17} />}
          </span>
          <div>
            <span className="eyebrow">{success ? "Execution complete" : "Workflow ended"}</span>
            <h3 className="font-display text-2xl leading-tight text-ink-950">
              {success ? "Application submitted." : terminal?.label ?? "Stopped."}
            </h3>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-700">
          {detail.last_message ?? terminal?.description ?? (success ? "The assembled application was submitted." : "No submission was attempted.")}
        </p>

        {success && confirmationId && (
          <div className="mt-4">
            <span className="eyebrow">Confirmation</span>
            <button
              type="button"
              onClick={() => void copy()}
              className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left shadow-card transition hover:border-brand-200"
              aria-label="Copy confirmation id"
            >
              <span className="font-mono text-sm font-semibold tracking-wide text-ink-950">{confirmationId}</span>
              <span className="flex items-center gap-1 text-[11px] text-ink-500">
                {copied ? <Check size={13} className="text-ok-600" /> : <Copy size={13} />}
                {copied ? "copied" : "copy"}
              </span>
            </button>
            <p className="mt-2 font-mono text-[10px] text-ink-400">Simulated submission · no real external action was taken.</p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-line p-4 sm:flex-row">
        <Button variant="dark" className="flex-1" onClick={onStartOver}>
          <RotateCcw size={14} /> Start a new workflow
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onAudit}>
          <ScrollText size={14} /> View audit trail
        </Button>
      </div>
    </motion.section>
  );
}
