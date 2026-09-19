import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, ChevronDown } from "lucide-react";
import type { AuditEvent } from "@/types";
import { fmtConfidence, fmtTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { Badge } from "@/components/ui/Badge";
import { describeEvent, metaFor } from "./eventMeta";

interface ChatPanelProps {
  events: AuditEvent[];
  open: boolean;
  onToggle: () => void;
  className?: string;
}

const TONE_ICON: Record<string, string> = {
  neutral: "bg-canvas text-ink-500 border-line",
  brand: "bg-brand-50 text-brand-600 border-brand-100",
  ok: "bg-ok-50 text-ok-600 border-ok-100",
  warn: "bg-warn-50 text-warn-600 border-warn-100",
  err: "bg-err-50 text-err-600 border-err-100",
};

/** Companion feed of what the system did (secondary to the graph — never chat bubbles). */
export function ChatPanel({ events, open, onToggle, className }: ChatPanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const visible = events.filter((e) => e.event_type !== "state_activated");

  useEffect(() => {
    const el = listRef.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [visible.length, open]);

  return (
    <section className={cn("panel flex min-h-0 flex-col", className)} aria-label="System activity">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center justify-between rounded-t-2xl px-4 py-3 text-left transition hover:bg-canvas/70"
      >
        <span className="flex items-center gap-2">
          <Activity size={14} className="text-brand-600" />
          <span className="eyebrow">Activity</span>
        </span>
        <span className="flex items-center gap-2">
          <Badge tone={visible.length ? "brand" : "neutral"}>{visible.length}</Badge>
          <ChevronDown
            size={14}
            className={cn("text-ink-400 transition-transform", open ? "rotate-180" : "")}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <ol ref={listRef} className="slim-scroll max-h-[38vh] space-y-1 overflow-y-auto px-2 pb-2 lg:max-h-none lg:h-full">
              {visible.length === 0 && (
                <li className="px-2 pb-3 pt-1 text-xs leading-relaxed text-ink-400">
                  Nothing yet. Every plan, upload, extraction and decision shows up here as it happens.
                </li>
              )}
              {visible.map((e, i) => {
                const meta = metaFor(e.event_type);
                const Icon = meta.icon;
                const body = describeEvent(e);
                return (
                  <motion.li
                    key={e.event_id ?? `${e.timestamp}-${i}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                    className="flex items-start gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-canvas"
                  >
                    <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border", TONE_ICON[meta.tone])}>
                      <Icon size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-ink-900">{meta.label}</span>
                        <time className="shrink-0 font-mono text-[10px] tabular-nums text-ink-400" dateTime={e.timestamp}>
                          {fmtTime(e.timestamp)}
                        </time>
                      </div>
                      {body && <p className="truncate text-[11.5px] text-ink-500">{body}</p>}
                      {e.confidence !== undefined && e.confidence !== null && (
                        <span className="font-mono text-[10px] text-brand-700">confidence {fmtConfidence(e.confidence)}</span>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
