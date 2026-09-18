import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileUp,
  FileWarning,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import type { DocumentUploadResult, WorkflowDetail } from "@/types";
import { DOC_LABELS } from "@/types";
import { toUserMessage } from "@/services/errors";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface DocumentUploadProps {
  detail: WorkflowDetail | null;
  busy: boolean;
  disabled?: boolean;
  onUpload: (file: File) => Promise<DocumentUploadResult>;
  onContinue: () => void;
}

const STAGES = ["store", "extract", "classify", "validate"] as const;
const ACCEPT = ".pdf,.png,.jpg,.jpeg";
const MAX_MB = 10;

/** Fictional demo documents. Filenames drive the deterministic DEMO_MODE processor. */
const DEMO_DOCS: { name: string; label: string; hint: string; tone?: "warn" }[] = [
  { name: "transcript.pdf", label: "Transcript (GPA conflict)", hint: "Semester GPA 3.20 — triggers a review", tone: "warn" },
  { name: "transcript_corrected.pdf", label: "Transcript (corrected)", hint: "Semester GPA 3.70 — passes" },
  { name: "government_id.pdf", label: "Government ID", hint: "Alex Rivera · FF-ID-8841-DEMO" },
  { name: "income_certificate.pdf", label: "Income certificate", hint: "INC-2026-117" },
  { name: "essay.pdf", label: "Personal essay", hint: "Why I deserve the scholarship" },
];

type Outcome = { kind: "ok" | "warn" | "err"; text: string };

export function DocumentUpload({ detail, busy, disabled, onUpload, onContinue }: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const activeState =
    detail?.states.find((s) => s.id === detail.current_state && s.type === "document_required") ??
    detail?.states.find((s) => s.type === "document_required");
  const required = activeState?.required_documents ?? [];
  const collected = new Set(detail?.collected_documents ?? []);
  const missing = required.filter((d) => !collected.has(d));
  const allPresent = required.length > 0 && missing.length === 0;
  const locked = busy || disabled || uploading !== null;

  // Pipeline stage ticker while a file is in flight.
  useEffect(() => {
    if (!uploading) return;
    setStage(0);
    const id = window.setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 260);
    return () => window.clearInterval(id);
  }, [uploading]);

  const uploadFile = useCallback(
    async (file: File) => {
      setOutcome(null);
      if (file.size > MAX_MB * 1024 * 1024) {
        setOutcome({ kind: "err", text: `${file.name} is larger than ${MAX_MB} MB.` });
        return;
      }
      setUploading(file.name);
      try {
        const result = await onUpload(file);
        if (!result.classification) {
          setOutcome({
            kind: "warn",
            text: `${file.name} couldn't be classified (${Math.round((result.confidence ?? 0) * 100)}% confidence). Try a clearer scan or a different document.`,
          });
        } else if (result.issues.length) {
          setOutcome({
            kind: "warn",
            text: `${DOC_LABELS[result.classification] ?? result.classification} received — ${result.issues[0].message}`,
          });
        } else {
          setOutcome({
            kind: "ok",
            text: `${DOC_LABELS[result.classification] ?? result.classification} received · ${Math.round((result.confidence ?? 0) * 100)}% confidence`,
          });
        }
      } catch (err) {
        setOutcome({ kind: "err", text: toUserMessage(err) });
      } finally {
        setUploading(null);
      }
    },
    [onUpload],
  );

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void uploadFile(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const loadDemo = (name: string) => {
    const blob = new Blob([`%PDF-1.4 fictional ${name}`], { type: "application/pdf" });
    void uploadFile(new File([blob], name, { type: "application/pdf" }));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-3">
      <section className="panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Step · Documents</span>
            <h3 className="mt-1 text-[15px] font-semibold text-ink-950">Required documents</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              Each upload is stored, text-extracted, classified and cross-validated. Confidence
              below 60% blocks; 60–85% asks you to review.
            </p>
          </div>
          <Badge tone={allPresent ? "ok" : "neutral"} className="shrink-0 tabular-nums">
            {collected.size}/{required.length}
          </Badge>
        </div>

        <ul className="mt-4 grid gap-1.5" aria-label="Document checklist">
          {required.map((doc, i) => {
            const done = collected.has(doc);
            return (
              <motion.li
                key={doc}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className={cn(
                  "flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors duration-300",
                  done ? "border-ok-100 bg-ok-50/60" : "border-line bg-canvas/60",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full border text-[10px] transition-colors",
                      done ? "border-ok-500 bg-ok-500 text-white" : "border-line-strong bg-surface text-ink-400",
                    )}
                  >
                    {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn("text-[13px]", done ? "font-medium text-ink-900" : "text-ink-700")}>
                    {DOC_LABELS[doc] ?? doc.replace(/_/g, " ")}
                  </span>
                </span>
                <span className={cn("font-mono text-[10px] uppercase tracking-wider", done ? "text-ok-600" : "text-ink-400")}>
                  {done ? "received" : "pending"}
                </span>
              </motion.li>
            );
          })}
          {required.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-500">
              This state lists no required documents.
            </li>
          )}
        </ul>

        <div
          role="button"
          tabIndex={locked ? -1 : 0}
          aria-disabled={locked}
          aria-label="Upload a document"
          onClick={() => !locked && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (!locked && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!locked) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!locked) onFiles(e.dataTransfer.files);
          }}
          className={cn(
            "group relative mt-4 flex w-full cursor-pointer flex-col items-center gap-1.5 overflow-hidden rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-all",
            dragging
              ? "border-brand-500 bg-brand-50"
              : "border-line-strong bg-canvas/40 hover:border-brand-200 hover:bg-brand-50/40",
            locked && "pointer-events-none opacity-60",
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {uploading ? (
              <motion.div
                key="pipeline"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex w-full flex-col items-center gap-3"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white shadow-raised">
                  <Sparkles size={16} className="animate-pulse" />
                </span>
                <p className="max-w-full truncate text-[13px] font-medium text-ink-900">Processing {uploading}</p>
                <ol className="flex items-center gap-1" aria-label="Pipeline stages">
                  {STAGES.map((s, i) => (
                    <li key={s} className="flex items-center gap-1">
                      <span
                        className={cn(
                          "rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors duration-300",
                          i < stage
                            ? "bg-ok-50 text-ok-600"
                            : i === stage
                              ? "bg-brand-600 text-white"
                              : "bg-surface text-ink-400 ring-1 ring-line",
                        )}
                      >
                        {s}
                      </span>
                      {i < STAGES.length - 1 && <span className="h-px w-2 bg-line-strong" />}
                    </li>
                  ))}
                </ol>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex flex-col items-center gap-1.5"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-brand-600 shadow-card transition group-hover:-translate-y-0.5">
                  <FileUp size={17} />
                </span>
                <p className="text-[13px] font-medium text-ink-900">
                  Drop a document or <span className="text-brand-700 underline decoration-brand-200 underline-offset-2">browse</span>
                </p>
                <p className="font-mono text-[10px] text-ink-400">PDF · PNG · JPEG · up to {MAX_MB} MB</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <input ref={inputRef} type="file" className="hidden" accept={ACCEPT} onChange={(e) => onFiles(e.target.files)} />

        <AnimatePresence>
          {outcome && (
            <motion.p
              key={outcome.text}
              role={outcome.kind === "err" ? "alert" : "status"}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed",
                outcome.kind === "ok" && "border-ok-100 bg-ok-50 text-ok-600",
                outcome.kind === "warn" && "border-warn-100 bg-warn-50 text-warn-600",
                outcome.kind === "err" && "border-err-100 bg-err-50 text-err-600",
              )}
            >
              {outcome.kind === "ok" ? <Check size={14} className="mt-0.5 shrink-0" /> : outcome.kind === "warn" ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <FileWarning size={14} className="mt-0.5 shrink-0" />}
              <span>{outcome.text}</span>
            </motion.p>
          )}
        </AnimatePresence>

        <div className="mt-4">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Demo documents</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DEMO_DOCS.map((d) => (
              <button
                key={d.name}
                type="button"
                disabled={locked}
                onClick={() => loadDemo(d.name)}
                title={d.hint}
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition disabled:opacity-50",
                  d.tone === "warn"
                    ? "border-warn-100 bg-warn-50/50 hover:border-warn-500/50 hover:bg-warn-50"
                    : "border-line bg-surface hover:border-brand-200 hover:bg-brand-50/50",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink-900">{d.label}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-400">{d.name}</span>
                </span>
                <UploadCloud size={13} className="shrink-0 text-ink-400 transition group-hover:text-brand-600" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-3 bg-gradient-to-t from-canvas via-canvas to-transparent px-3 pb-1 pt-3">
        <Button
          variant={allPresent ? "primary" : "secondary"}
          size="lg"
          className="w-full shadow-raised"
          onClick={onContinue}
          disabled={!allPresent || locked}
          loading={busy && allPresent}
        >
          {allPresent ? "Run validation" : missing.length ? `${missing.length} document${missing.length === 1 ? "" : "s"} still needed` : "Waiting for documents"}
          {allPresent && !busy && <ArrowRight size={15} />}
        </Button>
      </div>
    </motion.div>
  );
}
