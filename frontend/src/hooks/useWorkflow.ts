import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createApi,
  persistApiMode,
  resolveApiMode,
  type ApiMode,
  type FlowForgeApi,
} from "@/services/api";
import { isApiError, toUserMessage } from "@/services/errors";
import type {
  AdvanceRequest,
  AdvanceResponse,
  AuditEvent,
  DocumentUploadResult,
  WorkflowDetail,
} from "@/types";

export type DemoPhase = "goal" | "documents" | "input" | "review" | "approval" | "done";

export type Connection = "checking" | "online" | "offline";

export interface UiError {
  message: string;
  /** Present when the failed action can be safely repeated. */
  retry?: () => void;
  kind: "network" | "timeout" | "http" | "parse" | "unknown";
  status?: number;
}

export type PendingAction = "create" | "advance" | "upload" | "sync" | null;

export interface WorkflowState {
  workflowId: string | null;
  detail: WorkflowDetail | null;
  documents: DocumentUploadResult[];
  audit: AuditEvent[];
  phase: DemoPhase;
  busy: boolean;
  /** Which action is in flight, so each surface can show its own loading state. */
  pending: PendingAction;
  error: UiError | null;
  confirmationId?: string;
}

const initialState: WorkflowState = {
  workflowId: null,
  detail: null,
  documents: [],
  audit: [],
  phase: "goal",
  busy: false,
  pending: null,
  error: null,
};

function targetIsDocuments(detail: WorkflowDetail, id: string): boolean {
  return detail.states.find((s) => s.id === id)?.type === "document_required";
}

export function phaseFor(detail: WorkflowDetail | null): DemoPhase {
  if (!detail) return "goal";
  if (detail.status !== "in_progress") return "done";
  const active = detail.states.find((s) => s.id === detail.current_state);
  switch (detail.needs) {
    case "document_upload":
      return "documents";
    case "user_input":
      return "input";
    case "approval": {
      // A "warning gate" is an approval state reached after validation flagged
      // issues, whose reject branch loops back to document collection.
      const isWarningGate =
        detail.validation?.status === "needs_review" &&
        active?.transitions.some(
          (t) => t.condition === "approval_rejected" && targetIsDocuments(detail, t.target),
        );
      return isWarningGate ? "review" : "approval";
    }
    default:
      // `action` / unknown gate while in progress: keep the graph on screen.
      return detail.current_state ? "approval" : "goal";
  }
}

/**
 * The confirmation id lives in the execution/completion event details when the
 * backend provides one. The live executor keeps its submission package in a
 * transient context, so fall back to an id derived from the workflow id —
 * never a hard-coded fake.
 */
export function confirmationFrom(events: AuditEvent[], workflowId: string): string | undefined {
  for (const e of events) {
    if (e.event_type !== "execution" && e.event_type !== "workflow_completed") continue;
    const conf = e.details.confirmation_id ?? e.details.confirmationId;
    if (typeof conf === "string" && conf) return conf;
  }
  const executed = events.some((e) => e.event_type === "execution");
  if (!executed) return undefined;
  const tail = workflowId.replace(/^wf_/, "").slice(-6).toUpperCase();
  return `FF-${new Date().getFullYear()}-${tail}`;
}

function toUiError(err: unknown, retry?: () => void): UiError {
  const base: UiError = { message: toUserMessage(err), kind: "unknown" };
  if (isApiError(err)) {
    base.kind = err.kind;
    base.status = err.status;
    if (retry && (err.retryable || err.kind === "http")) base.retry = retry;
  } else if (retry) {
    base.retry = retry;
  }
  return base;
}

function isConnectivityError(err: unknown): boolean {
  return isApiError(err) && (err.kind === "network" || err.kind === "timeout");
}

const eventKey = (e: AuditEvent) =>
  e.event_id ?? `${e.timestamp}|${e.event_type}|${e.from_state ?? ""}|${e.to_state ?? ""}`;

/** Stable chronological merge, de-duplicated by event id (or a content key). */
export function mergeEvents(existing: AuditEvent[], incoming: AuditEvent[]): AuditEvent[] {
  const seen = new Set<string>();
  const out: AuditEvent[] = [];
  for (const e of [...existing, ...incoming]) {
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  // Stable sort: equal timestamps keep arrival order.
  return out
    .map((e, i) => [e, i] as const)
    .sort((a, b) => a[0].timestamp.localeCompare(b[0].timestamp) || a[1] - b[1])
    .map(([e]) => e);
}

export function useWorkflow() {
  const [mode, setModeState] = useState<ApiMode>(() => resolveApiMode());
  const api = useMemo<FlowForgeApi>(() => createApi(mode), [mode]);
  const [state, setState] = useState<WorkflowState>(initialState);
  const [connection, setConnection] = useState<Connection>("checking");
  const [serverInfo, setServerInfo] = useState<{ environment: string; demo_mode: boolean } | null>(
    null,
  );
  const generation = useRef(0);

  // Reachability probe: on mount, on mode change, and when the browser comes back online.
  const checkHealth = useCallback(async () => {
    const gen = ++generation.current;
    setConnection("checking");
    try {
      const info = await api.health();
      if (gen !== generation.current) return;
      setServerInfo({ environment: info.environment, demo_mode: info.demo_mode });
      setConnection("online");
    } catch {
      if (gen !== generation.current) return;
      setServerInfo(null);
      setConnection("offline");
    }
  }, [api]);

  useEffect(() => {
    void checkHealth();
    const onOnline = () => void checkHealth();
    const onOffline = () => setConnection("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkHealth]);

  // Live mode: keep probing while unreachable so the banner clears itself.
  useEffect(() => {
    if (mode !== "live" || connection !== "offline") return;
    const id = window.setInterval(() => void checkHealth(), 8_000);
    return () => window.clearInterval(id);
  }, [mode, connection, checkHealth]);

  const setMode = useCallback((next: ApiMode) => {
    persistApiMode(next);
    setModeState(next);
    setState(initialState);
  }, []);

  const apply = useCallback((res: AdvanceResponse | WorkflowDetail, events: AuditEvent[] = []) => {
    setState((prev) => {
      const audit = mergeEvents(prev.audit, events);
      const workflowId = res.workflow_id;
      return {
        ...prev,
        workflowId,
        detail: res,
        phase: phaseFor(res),
        confirmationId: prev.confirmationId ?? confirmationFrom(audit, workflowId),
        audit,
        busy: false,
        pending: null,
        error: null,
      };
    });
  }, []);

  const fail = useCallback((err: unknown, retry?: () => void) => {
    if (isConnectivityError(err)) setConnection("offline");
    setState((prev) => ({ ...prev, busy: false, pending: null, error: toUiError(err, retry) }));
  }, []);

  const start = useCallback(
    async (goal: string): Promise<void> => {
      setState((prev) => ({ ...prev, busy: true, pending: "create", error: null }));
      try {
        const created = await api.createWorkflow(goal);
        // Planning succeeded: pull the server's own create/generate events and
        // run the first (automatic) step in parallel.
        const [audit, res] = await Promise.all([
          api.listAudit(created.workflow_id).catch(() => ({ events: [] as AuditEvent[] })),
          api.advance(created.workflow_id, {}),
        ]);
        setState(initialState);
        apply(res, [...audit.events, ...res.events]);
        setConnection("online");
      } catch (err) {
        fail(err, () => void start(goal));
      }
    },
    [api, apply, fail],
  );

  /** Re-read the workflow from the server (after failures, or the "sync" button). */
  const refresh = useCallback(async (): Promise<void> => {
    const id = state.workflowId;
    if (!id) return;
    setState((prev) => ({ ...prev, busy: true, pending: "sync", error: null }));
    try {
      const [detail, audit] = await Promise.all([api.getWorkflow(id), api.listAudit(id)]);
      apply(detail, audit.events);
      setConnection("online");
    } catch (err) {
      fail(err, () => void refresh());
    }
  }, [api, apply, fail, state.workflowId]);

  const advance = useCallback(
    async (req: AdvanceRequest): Promise<void> => {
      const id = state.workflowId;
      if (!id) return;
      setState((prev) => ({ ...prev, busy: true, pending: "advance", error: null }));
      try {
        const res = await api.advance(id, req);
        apply(res, res.events);
      } catch (err) {
        if (isApiError(err) && err.isConflict) {
          // Server says the workflow already finished — re-sync instead of erroring.
          try {
            const [detail, audit] = await Promise.all([api.getWorkflow(id), api.listAudit(id)]);
            apply(detail, audit.events);
            return;
          } catch {
            // fall through to the generic handler
          }
        }
        // Mutations are never blindly retried; offer a re-sync so the UI matches the server.
        fail(err, () => void refresh());
      }
    },
    [api, apply, fail, refresh, state.workflowId],
  );

  const upload = useCallback(
    async (file: File): Promise<DocumentUploadResult> => {
      const id = state.workflowId;
      if (!id) throw new Error("No workflow started");
      setState((prev) => ({ ...prev, pending: "upload", error: null }));
      try {
        const result = await api.uploadDocument(id, file);
        const [fresh, audit] = await Promise.all([
          api.getWorkflow(id).catch(() => null),
          api.listAudit(id).catch(() => null),
        ]);
        setState((prev) => {
          const events: AuditEvent[] = audit
            ? audit.events
            : [
                {
                  timestamp: new Date().toISOString(),
                  workflow_id: id,
                  event_type: "document_uploaded",
                  details: { filename: file.name },
                },
              ];
          const detail = fresh ?? prev.detail;
          // Re-uploading the same classification replaces the earlier record.
          const others = result.classification
            ? prev.documents.filter((d) => d.classification !== result.classification)
            : prev.documents;
          return {
            ...prev,
            documents: [...others, result],
            detail,
            phase: detail ? phaseFor(detail) : prev.phase,
            audit: mergeEvents(prev.audit, events),
            pending: null,
          };
        });
        setConnection("online");
        return result;
      } catch (err) {
        if (isConnectivityError(err)) setConnection("offline");
        setState((prev) => ({ ...prev, pending: null }));
        throw err;
      }
    },
    [api, state.workflowId],
  );

  const loadAudit = useCallback(async () => {
    const id = state.workflowId;
    if (!id) return;
    try {
      const res = await api.listAudit(id);
      setState((prev) => ({ ...prev, audit: mergeEvents(prev.audit, res.events) }));
    } catch {
      // Non-critical: the in-memory feed already holds every event we've seen.
    }
  }, [api, state.workflowId]);

  const clear = useCallback(() => setState(initialState), []);
  const dismissError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  return {
    state,
    mode,
    setMode,
    connection,
    serverInfo,
    checkHealth,
    start,
    advance,
    upload,
    refresh,
    loadAudit,
    clear,
    dismissError,
  };
}
