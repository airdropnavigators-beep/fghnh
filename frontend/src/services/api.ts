/**
 * API client for FlowForge.
 *
 * Two interchangeable implementations behind `FlowForgeApi`:
 *  - `MockApi`  — deterministic offline demo (`services/mock.ts`), the default.
 *  - `HttpApi`  — the real FastAPI backend. Enable with `VITE_USE_MOCK=false`;
 *    `VITE_API_BASE` defaults to `/api`, which the Vite dev server proxies to
 *    `127.0.0.1:8000` (see `vite.config.ts`). In production point it at the
 *    deployed API Gateway URL.
 *
 * The mode can also be flipped at runtime (`?api=live` / `?api=mock` or
 * `localStorage.flowforge.api`) so a single build can drive both demos.
 */

import type {
  AdvanceRequest,
  AdvanceResponse,
  AuditResponse,
  CreateWorkflowResult,
  DocumentUploadResult,
  WorkflowDetail,
} from "../types";
import { ApiError } from "./errors";
import { fetchJson } from "./http";
import { mockApi } from "./mock";
import {
  normalizeAdvance,
  normalizeAudit,
  normalizeCreate,
  normalizeDetail,
  normalizeUpload,
} from "./normalize";

export type ApiMode = "mock" | "live";

export interface HealthInfo {
  app: string;
  environment: string;
  demo_mode: boolean;
  user?: string;
}

export interface FlowForgeApi {
  readonly mode: ApiMode;
  createWorkflow(goal: string): Promise<CreateWorkflowResult>;
  getWorkflow(workflowId: string): Promise<WorkflowDetail>;
  advance(workflowId: string, req: AdvanceRequest): Promise<AdvanceResponse>;
  uploadDocument(workflowId: string, file: File): Promise<DocumentUploadResult>;
  listAudit(workflowId: string): Promise<AuditResponse>;
  /** Reachability probe; resolves with server info or throws an `ApiError`. */
  health(): Promise<HealthInfo>;
}

export const API_BASE = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/$/, "");

const MODE_STORAGE_KEY = "flowforge.api";

/** Resolve the API mode: URL param > localStorage > build-time env > mock. */
export function resolveApiMode(): ApiMode {
  if (typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get("api");
    if (fromUrl === "live" || fromUrl === "mock") {
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, fromUrl);
      } catch {
        // storage unavailable (private mode) — URL param still wins for this load
      }
      return fromUrl;
    }
    try {
      const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "live" || stored === "mock") return stored;
    } catch {
      // ignore
    }
  }
  return import.meta.env.VITE_USE_MOCK === "false" ? "live" : "mock";
}

export function persistApiMode(mode: ApiMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export class HttpApi implements FlowForgeApi {
  readonly mode = "live" as const;

  constructor(private readonly base: string = API_BASE) {}

  private url(path: string): string {
    return `${this.base}${path}`;
  }

  health(): Promise<HealthInfo> {
    return fetchJson<HealthInfo>(this.url("/health"), { timeoutMs: 4_000, headers: { Accept: "application/json" } });
  }

  async createWorkflow(goal: string): Promise<CreateWorkflowResult> {
    // Workflow planning may call a foundation model — allow a generous deadline.
    // Not retried: a retry could plan (and bill) twice.
    const raw = await fetchJson<unknown>(this.url("/workflows"), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ goal }),
      timeoutMs: 60_000,
    });
    return normalizeCreate(raw);
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDetail> {
    const raw = await fetchJson<unknown>(this.url(`/workflows/${encodeURIComponent(workflowId)}`), {
      headers: { Accept: "application/json" },
      retries: 2,
    });
    return normalizeDetail(raw);
  }

  async advance(workflowId: string, req: AdvanceRequest): Promise<AdvanceResponse> {
    // Advancing is a state mutation — never auto-retry; the executor is the
    // source of truth and the UI re-syncs with GET on failure.
    const raw = await fetchJson<unknown>(this.url(`/workflows/${encodeURIComponent(workflowId)}/advance`), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(req),
      timeoutMs: 30_000,
    });
    return normalizeAdvance(raw);
  }

  async uploadDocument(workflowId: string, file: File): Promise<DocumentUploadResult> {
    const form = new FormData();
    form.append("file", file, file.name);
    // Textract/Bedrock extraction can take a while on real documents.
    const raw = await fetchJson<unknown>(this.url(`/workflows/${encodeURIComponent(workflowId)}/documents`), {
      method: "POST",
      body: form,
      headers: { Accept: "application/json" },
      timeoutMs: 90_000,
    });
    return normalizeUpload(raw);
  }

  async listAudit(workflowId: string): Promise<AuditResponse> {
    const raw = await fetchJson<unknown>(this.url(`/workflows/${encodeURIComponent(workflowId)}/audit`), {
      headers: { Accept: "application/json" },
      retries: 2,
    });
    return normalizeAudit(raw);
  }
}

export class MockApi implements FlowForgeApi {
  readonly mode = "mock" as const;

  async health(): Promise<HealthInfo> {
    return { app: "FlowForge (offline mock)", environment: "browser", demo_mode: true, user: "demo-user" };
  }

  async createWorkflow(goal: string): Promise<CreateWorkflowResult> {
    return mockApi.createWorkflow(goal);
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDetail> {
    return mockApi.getWorkflow(workflowId);
  }

  async advance(workflowId: string, req: AdvanceRequest): Promise<AdvanceResponse> {
    return mockApi.advance(workflowId, req);
  }

  async uploadDocument(workflowId: string, file: File): Promise<DocumentUploadResult> {
    return mockApi.uploadDocument(workflowId, file);
  }

  async listAudit(workflowId: string): Promise<AuditResponse> {
    return mockApi.listAudit(workflowId);
  }
}

export function createApi(mode: ApiMode = resolveApiMode()): FlowForgeApi {
  return mode === "live" ? new HttpApi() : new MockApi();
}

export { ApiError };