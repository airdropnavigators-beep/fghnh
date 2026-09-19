/**
 * Typed client errors so the UI can distinguish "the backend is down" from
 * "the backend said no" and pick the right copy + recovery action.
 */

export type ApiErrorKind =
  | "network" // fetch rejected: offline, DNS, CORS, connection refused
  | "timeout" // request aborted by our deadline
  | "http" // non-2xx response
  | "parse"; // 2xx but body was not the JSON we expected

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  /** Machine-readable detail from the server (FastAPI `detail`), if any. */
  readonly detail: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    opts: { status?: number; retryable?: boolean; detail?: unknown; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ApiError";
    this.kind = kind;
    this.status = opts.status;
    this.detail = opts.detail;
    this.retryable = opts.retryable ?? (kind === "network" || kind === "timeout");
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** 409 = workflow already finished / generation failed (domain conflict). */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * FastAPI returns `detail` either as a string (HTTPException) or as a list of
 * pydantic validation errors `{loc, msg, type}`. Flatten both to one sentence.
 */
export function messageFromDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        if (!d || typeof d !== "object") return null;
        const { loc, msg } = d as { loc?: unknown; msg?: unknown };
        const field = Array.isArray(loc)
          ? loc.filter((l) => typeof l === "string" && l !== "body").join(".")
          : "";
        return typeof msg === "string" ? (field ? `${field}: ${msg}` : msg) : null;
      })
      .filter((p): p is string => !!p);
    if (parts.length) return parts.join("; ");
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return fallback;
}

export function toUserMessage(err: unknown): string {
  if (isApiError(err)) {
    switch (err.kind) {
      case "network":
        return "Can't reach the FlowForge backend. Check that the API is running, then retry.";
      case "timeout":
        return "The backend took too long to respond. Retry, or check the API logs.";
      case "parse":
        return "The backend returned an unexpected response.";
      case "http":
        if (err.status && err.status >= 500) {
          return `Server error (${err.status}). ${err.message}`;
        }
        return err.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}
