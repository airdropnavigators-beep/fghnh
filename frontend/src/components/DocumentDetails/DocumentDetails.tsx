import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, FileText, FileQuestion, Files } from "lucide-react";
import type { DocumentUploadResult } from "@/types";
import { DOC_LABELS } from "@/types";
import { confidenceTone, fmtConfidence } from "@/utils/format";
import { cn } from "@/utils/cn";
import { Badge, type Tone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface DocumentDetailsProps {
  documents: DocumentUploadResult[];
}

const TONE: Record<"ok" | "warn" | "err", Tone> = { ok: "ok", warn: "warn", err: "err" };

function ConfidenceMeter({ value }: { value: number }) {
  const tone = confidenceTone(value);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${fmtConfidence(value)} confidence`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-line">
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(value * 100)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={cn("block h-full rounded-full", tone === "ok" ? "bg-ok-500" : tone === "warn" ? "bg-warn-500" : "bg-err-500")}
        />
      </span>
      <span className={cn("font-mono text-[10px] tabular-nums", tone === "ok" ? "text-ok-600" : tone === "warn" ? "text-warn-600" : "text-err-600")}>
        {fmtConfidence(value)}
      </span>
    </span>
  );
}

export function DocumentDetails({ documents }: DocumentDetailsProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (documents.length === 0) {
    return (
      <EmptyState
        compact
        icon={Files}
        title="No documents yet"
        body="Extracted fields, their source text and per-field confidence will appear here after the first upload."
      />
    );
  }

  // Latest upload per classification wins; unclassified uploads are listed individually.
  const latest = new Map<string, DocumentUploadResult>();
  for (const d of documents) latest.set(d.classification ?? d.document_id, d);
  const list = [...latest.values()].reverse();
  const expanded = openId ?? list[0]?.document_id;

  return (
    <section className="space-y-2" aria-label="Extracted fields">
      <div className="flex items-center justify-between px-1">
        <span className="eyebrow">Extracted fields</span>
        <span className="font-mono text-[10px] text-ink-400">{list.length} document{list.length === 1 ? "" : "s"}</span>
      </div>
      {list.map((doc, i) => {
        const open = expanded === doc.document_id;
        const fields = Object.entries(doc.extracted_fields);
        const unclassified = !doc.classification;
        const conf = doc.confidence ?? 0;
        return (
          <motion.article
            key={doc.document_id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className={cn("panel overflow-hidden", unclassified && "border-warn-100")}
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? "" : doc.document_id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-canvas/70"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg border", unclassified ? "border-warn-100 bg-warn-50 text-warn-600" : "border-line bg-canvas text-ink-700")}>
                  {unclassified ? <FileQuestion size={14} /> : <FileText size={14} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink-900">
                    {unclassified ? "Unclassified document" : DOC_LABELS[doc.classification!] ?? doc.classification}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ink-400">{doc.filename}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {doc.validation_status && doc.validation_status !== "pass" && (
                  <Badge tone={doc.validation_status === "block" ? "err" : "warn"}>{doc.validation_status.replace("_", " ")}</Badge>
                )}
                <Badge tone={TONE[confidenceTone(conf)]} className="tabular-nums">{fmtConfidence(conf)}</Badge>
                <ChevronDown size={14} className={cn("text-ink-400 transition-transform", open && "rotate-180")} />
              </span>
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  {fields.length === 0 ? (
                    <p className="border-t border-line px-4 py-3 text-xs text-ink-500">
                      {doc.message || "No fields could be extracted from this document."}
                    </p>
                  ) : (
                    <table className="w-full border-t border-line text-left text-xs">
                      <tbody>
                        {fields.map(([field, val]) => (
                          <tr key={field} className="group border-t border-line/70 first:border-t-0 hover:bg-canvas/70">
                            <th scope="row" className="w-[42%] px-4 py-2 font-mono text-[10.5px] font-medium text-ink-500">
                              {field}
                            </th>
                            <td className="px-2 py-2">
                              <span className="font-medium text-ink-900">{String(val.value)}</span>
                              {val.source_text && val.source_text !== String(val.value) && (
                                <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-400" title={val.source_text}>
                                  “{val.source_text}”
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <ConfidenceMeter value={val.confidence} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {doc.issues.length > 0 && (
                    <ul className="space-y-1 border-t border-line bg-warn-50/40 px-4 py-2.5">
                      {doc.issues.map((issue, k) => (
                        <li key={`${issue.field}-${k}`} className="text-[11.5px] leading-relaxed text-warn-600">
                          <span className="font-mono">{issue.field}</span> — {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.article>
        );
      })}
    </section>
  );
}
