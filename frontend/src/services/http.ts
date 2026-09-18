/**
 * Small fetch wrapper with deadlines, bounded retries and typed errors.
 *
 * Retry policy (idempotent requests only): network failures, timeouts and
 * 502/503/504 are retried with exponential backoff + jitter. Everything else
 * surfaces immediately.
 */

import { ApiError, messageFromDetail } from "./errors";

export interface RequestOptions extends Omit<RequestInit, "signal"> {
  /** Abort the request after this many ms (default 15s; uploads pass more). */
  timeoutMs?: number;
  /** Max additional attempts after the first (default 0 = no retry). */
  retries?: number;
  /** Caller-supplied signal; combined with the internal deadline. */
  signal?: AbortSignal | null;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function backoff(attempt: number): number {
  const base = 300 * 2 ** attempt;
  return Math.min(4_000, base + Math.random() * 200);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "AbortError" : false;
}

export async function fetchJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, signal: outer, ...init } = opts;

  let lastError: ApiError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (outer?.aborted) throw new ApiError("network", "Request cancelled.", { retryable: false });
    try {
      return await attemptOnce<T>(url, init, timeoutMs, outer ?? null);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError("network", "Request failed.", { cause: err });
      lastError = apiErr;
      const canRetry = apiErr.retryable && attempt < retries && !outer?.aborted;
      if (!canRetry) throw apiErr;
      await sleep(backoff(attempt));
    }
  }
  throw lastError ?? new ApiError("network", "Request failed.");
}

async function attemptOnce<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outer: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      if (timedOut) {
        throw new ApiError("timeout", `Request timed out after ${Math.round(timeoutMs / 1000)}s.`, { cause: err });
      }
      throw new ApiError("network", "Request cancelled.", { retryable: false, cause: err });
    }
    throw new ApiError("network", "Cannot reach the FlowForge backend.", { cause: err });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }

  if (!res.ok) {
    let detail: unknown = undefined;
    let text = "";
    try {
      text = await res.text();
      detail = text ? (JSON.parse(text) as { detail?: unknown }).detail : undefined;
    } catch {
      detail = undefined;
    }
    const fallback = res.statusText || `HTTP ${res.status}`;
    const message = messageFromDetail(detail, statusCopy(res.status, fallback));
    throw new ApiError("http", message, {
      status: res.status,
      detail,
      retryable: RETRYABLE_STATUS.has(res.status),
    });
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new ApiError("parse", "The backend returned an unexpected response.", { cause: err, retryable: false });
  }
}

function statusCopy(status: number, fallback: string): string {
  switch (status) {
    case 400:
      return "The request was rejected as invalid.";
    case 404:
      return "That workflow no longer exists on the server.";
    case 409:
      return "The workflow is already in a final state.";
    case 413:
      return "That file is too large for the backend to accept.";
    case 415:
      return "That file type isn't supported. Upload a PDF, PNG or JPEG.";
    case 422:
      return "The backend could not process this request.";
    case 429:
      return "Too many requests — slow down and retry.";
    default:
      return status >= 500 ? "The backend hit an internal error." : fallback;
  }
}
