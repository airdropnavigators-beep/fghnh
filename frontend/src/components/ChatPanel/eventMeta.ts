import {
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  CircleDot,
  FileUp,
  Flag,
  Rocket,
  ScanText,
  ShieldAlert,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { AuditEvent, AuditEventType } from "@/types";
import type { Tone } from "@/components/ui/Badge";

export interface EventMeta {
  icon: LucideIcon;
  label: string;
  tone: Tone;
}

export const EVENT_META: Record<AuditEventType, EventMeta> = {
  workflow_created: { icon: CircleDot, label: "Workflow created", tone: "brand" },
  workflow_generated: { icon: Bot, label: "Workflow planned", tone: "brand" },
  state_activated: { icon: Flag, label: "State activated", tone: "neutral" },
  state_transition: { icon: ArrowRightLeft, label: "Transition", tone: "neutral" },
  document_uploaded: { icon: FileUp, label: "Document uploaded", tone: "ok" },
  field_extracted: { icon: ScanText, label: "Fields extracted", tone: "brand" },
  human_approval: { icon: UserCheck, label: "Human decision", tone: "warn" },
  execution: { icon: Rocket, label: "Execution", tone: "brand" },
  workflow_completed: { icon: CheckCircle2, label: "Workflow finished", tone: "ok" },
  workflow_failed: { icon: ShieldAlert, label: "Workflow failed", tone: "err" },
};

export const FALLBACK_META: EventMeta = { icon: Bot, label: "Event", tone: "neutral" };

export function metaFor(type: string): EventMeta {
  return (EVENT_META as Record<string, EventMeta>)[type] ?? FALLBACK_META;
}

const pretty = (s: string) => s.replace(/_/g, " ");

/** One-line, human description of an event built from its details. */
export function describeEvent(e: AuditEvent): string | null {
  const d = e.details ?? {};
  switch (e.event_type) {
    case "workflow_created":
      return typeof d.goal === "string" ? `“${d.goal}”` : null;
    case "workflow_generated":
      return typeof d.states === "number" ? `${d.states} states, schema-valid` : "Plan validated";
    case "state_activated":
      return e.to_state ? pretty(e.to_state) : null;
    case "state_transition":
      return e.from_state && e.to_state ? `${pretty(e.from_state)} → ${pretty(e.to_state)}` : null;
    case "document_uploaded":
      return typeof d.filename === "string" ? d.filename : null;
    case "field_extracted":
      return typeof d.classification === "string" ? pretty(d.classification) : "Unclassified document";
    case "human_approval":
      return d.approved === true
        ? `Approved at ${pretty(e.from_state ?? "gate")}`
        : d.approved === false
          ? `Rejected at ${pretty(e.from_state ?? "gate")}`
          : null;
    case "execution":
      return typeof d.confirmation_id === "string" ? `Confirmation ${d.confirmation_id}` : "Simulated submission";
    case "workflow_completed":
      return typeof d.final_status === "string" ? `Final status: ${pretty(d.final_status)}` : null;
    case "workflow_failed":
      return typeof d.reason === "string" ? d.reason : null;
    default:
      return null;
  }
}
