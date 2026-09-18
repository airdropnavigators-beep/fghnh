/**
 * Defensive shape checks for backend responses.
 *
 * A 2xx with an unexpected body (proxy error page, half-deployed API, a
 * misconfigured `VITE_API_BASE`) must surface as a `parse` error instead of
 * crashing a component on `undefined.length`. Optional collections are filled
 * with empty defaults so the UI can rely on them.
 */

import type {
  AdvanceResponse,
  AuditEvent,
  AuditResponse,
  CreateWorkflowResult,
  DocumentUploadResult,
  WorkflowDetail,
  WorkflowState,
} from "../types";
import { ApiError } from "./errors";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function bad(what: string): ApiError {
  return new ApiError("parse", `The backend returned an unexpected ${what} payload.`, { retryable: false });
}

function state(raw: unknown): WorkflowState {
  if (!isObj(raw) || typeof raw.id !== "string") throw bad("workflow state");
  return {
    id: raw.id,
    label: typeof raw.label === "string" ? raw.label : raw.id,
    type: (raw.type as WorkflowState["type"]) ?? "automatic",
    description: typeof raw.description === "string" ? raw.description : "",
    required_data: Array.isArray(raw.required_data) ? (raw.required_data as string[]) : [],
    required_documents: Array.isArray(raw.required_documents) ? (raw.required_documents as string[]) : [],
    transitions: Array.isArray(raw.transitions)
      ? (raw.transitions as unknown[]).filter(isObj).map((t) => ({
          target: String(t.target ?? ""),
          condition: String(t.condition ?? ""),
        }))
      : [],
    confidence_threshold: typeof raw.confidence_threshold === "number" ? raw.confidence_threshold : undefined,
    status: (raw.status as WorkflowState["status"]) ?? "pending",
  };
}

export function normalizeDetail(raw: unknown): WorkflowDetail {
  if (!isObj(raw) || typeof raw.workflow_id !== "string" || !Array.isArray(raw.states) || !isObj(raw.progress)) {
    throw bad("workflow");
  }
  const p = raw.progress;
  return {
    workflow_id: raw.workflow_id,
    status: (raw.status as WorkflowDetail["status"]) ?? "in_progress",
    goal: typeof raw.goal === "string" ? raw.goal : "",
    current_state: typeof raw.current_state === "string" ? raw.current_state : null,
    last_message: typeof raw.last_message === "string" ? raw.last_message : null,
    needs: typeof raw.needs === "string" ? raw.needs : null,
    progress: {
      completed: Number(p.completed ?? 0),
      total: Math.max(1, Number(p.total ?? 1)),
      ratio: Number(p.ratio ?? 0),
    },
    states: (raw.states as unknown[]).map(state),
    collected_documents: Array.isArray(raw.collected_documents) ? (raw.collected_documents as string[]) : [],
    validation: isObj(raw.validation)
      ? {
          status: (raw.validation.status as NonNullable<WorkflowDetail["validation"]>["status"]) ?? "block",
          confidence: Number(raw.validation.confidence ?? 0),
          issues: Array.isArray(raw.validation.issues) ? (raw.validation.issues as NonNullable<WorkflowDetail["validation"]>["issues"]) : [],
          suggestions: Array.isArray(raw.validation.suggestions) ? (raw.validation.suggestions as string[]) : [],
          checked_documents: Array.isArray(raw.validation.checked_documents)
            ? (raw.validation.checked_documents as string[])
            : [],
        }
      : null,
  };
}

export function normalizeEvent(raw: unknown): AuditEvent {
  if (!isObj(raw) || typeof raw.event_type !== "string") throw bad("audit event");
  return {
    event_id: typeof raw.event_id === "string" ? raw.event_id : undefined,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    workflow_id: typeof raw.workflow_id === "string" ? raw.workflow_id : "",
    event_type: raw.event_type as AuditEvent["event_type"],
    from_state: typeof raw.from_state === "string" ? raw.from_state : null,
    to_state: typeof raw.to_state === "string" ? raw.to_state : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    details: isObj(raw.details) ? raw.details : {},
  };
}

export function normalizeAdvance(raw: unknown): AdvanceResponse {
  const detail = normalizeDetail(raw);
  const r = raw as Record<string, unknown>;
  return {
    ...detail,
    message: typeof r.message === "string" ? r.message : null,
    completed: Boolean(r.completed ?? detail.status !== "in_progress"),
    events: Array.isArray(r.events) ? (r.events as unknown[]).map(normalizeEvent) : [],
  };
}

export function normalizeAudit(raw: unknown): AuditResponse {
  if (!isObj(raw) || !Array.isArray(raw.events)) throw bad("audit");
  return {
    workflow_id: typeof raw.workflow_id === "string" ? raw.workflow_id : "",
    events: (raw.events as unknown[]).map(normalizeEvent),
  };
}

export function normalizeCreate(raw: unknown): CreateWorkflowResult {
  if (!isObj(raw) || typeof raw.workflow_id !== "string" || !isObj(raw.workflow)) throw bad("workflow");
  const wf = raw.workflow;
  return {
    workflow_id: raw.workflow_id,
    status: (raw.status as CreateWorkflowResult["status"]) ?? "in_progress",
    workflow: {
      workflow_id: typeof wf.workflow_id === "string" ? wf.workflow_id : raw.workflow_id,
      goal: typeof wf.goal === "string" ? wf.goal : "",
      initial_state: typeof wf.initial_state === "string" ? wf.initial_state : "",
      terminal_states: Array.isArray(wf.terminal_states) ? (wf.terminal_states as string[]) : [],
      states: Array.isArray(wf.states) ? (wf.states as unknown[]).map(state) : [],
    },
  };
}

export function normalizeUpload(raw: unknown): DocumentUploadResult {
  if (!isObj(raw) || typeof raw.document_id !== "string") throw bad("document");
  const fields = isObj(raw.extracted_fields) ? raw.extracted_fields : {};
  return {
    document_id: raw.document_id,
    filename: typeof raw.filename === "string" ? raw.filename : "document",
    classification: typeof raw.classification === "string" ? raw.classification : null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    extracted_fields: Object.fromEntries(
      Object.entries(fields)
        .filter(([, v]) => isObj(v))
        .map(([k, v]) => {
          const f = v as Record<string, unknown>;
          return [
            k,
            {
              value: String(f.value ?? ""),
              confidence: typeof f.confidence === "number" ? f.confidence : 0,
              source_text: typeof f.source_text === "string" ? f.source_text : "",
            },
          ];
        }),
    ),
    validation_status: typeof raw.validation_status === "string" ? raw.validation_status : null,
    issues: Array.isArray(raw.issues) ? (raw.issues as DocumentUploadResult["issues"]) : [],
    message: typeof raw.message === "string" ? raw.message : "",
  };
}
