import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, RefreshCw, ScrollText, X } from "lucide-react";
import type { AuditEvent, AuditEventType } from "@/types";
import { fmtConfidence, fmtTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { describeEvent, metaFor } from "@/components/ChatPanel/eventMeta";

interface AuditLogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: AuditEvent[];
  workflowId: string | null;
  onRefresh?: () => Promise<void> | void;
}

type Filter = "all" | "decisions" | AuditEventType;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "decisions", label: "Decisions" },
  { id: "document_uploaded", label: "Uploads" },
  { id: "field_extracted", label: "Extraction" },
  { id: "state_transition", label: "Transitions" },
  { id: "execution", label: "Execution" },
];

const DECISION_TYPES = new Set<AuditEventType>(["human_approval", "execution", "workflow_completed", "workflow_failed"]);

const TONE_ICON: Record<string, string> = {
  neutral: "bg-canvas text-ink-500 border-line",
  brand: "bg-brand-50 text-brand-600 border-brand-100",
  ok: "bg-ok-50 text-ok-600 border-ok-100",
  warn: "bg-warn-50 text-warn-600 border-warn-100",
  err: "bg-err-50 text-err-600 border-err-100",
};

function exportJson(events: AuditEvent[], workflowId: string | null) {
  const blob = new Blob([JSON.stringify({ workflow_id: workflowId, events }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flowforge-audit-${workflowId ?? "session"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditLog({ open, onOpenChange, events, workflowId, onRefresh }: AuditLogProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const visible = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "decisions") return events.filter((e) => DECISION_TYPES.has(e.event_type));
    return events.filter((e) => e.event_type === filter);
  }, [events, filter]);

  useEffect(() => {
    if (!open) return;
    // The sheet mounts with an enter animation; scroll once the list has laid out.
    const id = window.setTimeout(() => {
      const el = listRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [open, visible.length]);

  const refresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-ink-950">
              <ScrollText size={16} className="text-brand-600" />
              Audit trail
            </DialogTitle>
            <DialogDescription className="mt-0.5 font-mono text-[10.5px] text-ink-400">
              {workflowId ?? "no workflow"} · {events.length} event{events.length === 1 ? "" : "s"}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh from server" disabled={refreshing}>
                <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => exportJson(events, workflowId)} aria-label="Export JSON" disabled={!events.length}>
              <Download size={14} />
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close audit trail">
                <X size={15} />
              </Button>
            </DialogClose>
          </div>
        </header>

        <div className="slim-scroll flex gap-1.5 overflow-x-auto border-b border-line px-5 py-2.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "chip shrink-0 cursor-pointer transition",
                filter === f.id ? "border-ink-950 bg-ink-950 text-white" : "chip-neutral hover:border-line-strong hover:bg-surface",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <ol ref={listRef} className="slim-scroll relative flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
          {visible.length === 0 ? (
            <li>
              <EmptyState
                compact
                icon={ScrollText}
                title={events.length ? "No events match this filter" : "No events yet"}
                body={events.length ? "Try another filter." : "Every meaningful action is recorded here with its timestamp, transition and confidence."}
              />
            </li>
          ) : (
            visible.map((e, i) => {
              const meta = metaFor(e.event_type);
              const Icon = meta.icon;
              const body = describeEvent(e);
              const last = i === visible.length - 1;
              return (
                <motion.li
                  key={e.event_id ?? `${e.timestamp}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i, 10) * 0.02 }}
                  className="relative flex gap-3 pb-4"
                >
                  {!last && <span className="absolute left-[13px] top-8 h-[calc(100%-16px)] w-px bg-line" aria-hidden />}
                  <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border", TONE_ICON[meta.tone])}>
                    <Icon size={13} />
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface p-3 shadow-card">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink-900">{meta.label}</span>
                      <time className="shrink-0 font-mono text-[10px] tabular-nums text-ink-400" dateTime={e.timestamp}>
                        {fmtTime(e.timestamp)}
                      </time>
                    </div>
                    {body && <p className="mt-1 text-[12px] leading-relaxed text-ink-700">{body}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {e.from_state && e.to_state && e.event_type !== "state_transition" && (
                        <span className="font-mono text-[10px] text-ink-400">
                          {e.from_state} → {e.to_state}
                        </span>
                      )}
                      {e.confidence !== undefined && e.confidence !== null && (
                        <Badge tone="brand" className="tabular-nums">confidence {fmtConfidence(e.confidence)}</Badge>
                      )}
                      {e.event_type === "human_approval" && (
                        <Badge tone={e.details.approved ? "ok" : "err"}>{e.details.approved ? "approved" : "rejected"}</Badge>
                      )}
                    </div>
                  </div>
                </motion.li>
              );
            })
          )}
        </ol>
      </SheetContent>
    </Dialog>
  );
}
