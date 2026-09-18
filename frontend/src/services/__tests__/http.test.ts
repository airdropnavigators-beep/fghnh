import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, messageFromDetail, toUserMessage } from "../errors";
import { fetchJson } from "../http";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("fetchJson", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns parsed JSON on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await expect(fetchJson<{ ok: boolean }>("/x")).resolves.toEqual({ ok: true });
  });

  it("maps a FastAPI string detail to an http ApiError", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "workflow 'abc' not found" }, { status: 404 }));
    const err = await fetchJson("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    expect(api.kind).toBe("http");
    expect(api.status).toBe(404);
    expect(api.isNotFound).toBe(true);
    expect(api.retryable).toBe(false);
    expect(api.message).toBe("workflow 'abc' not found");
  });

  it("flattens pydantic validation errors instead of rendering [object Object]", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { detail: [{ type: "string_too_short", loc: ["body", "goal"], msg: "String should have at least 3 characters" }] },
        { status: 422 },
      ),
    );
    const err = (await fetchJson("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe("goal: String should have at least 3 characters");
  });

  it("does not retry non-idempotent failures by default", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = (await fetchJson("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network failures and 503s up to `retries`, then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ detail: "busy" }, { status: 503 }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    vi.useFakeTimers();
    const p = fetchJson<{ ok: number }>("/x", { retries: 2 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does not retry 4xx even when retries are allowed", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "nope" }, { status: 409 }));
    const err = (await fetchJson("/x", { retries: 3 }).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(409);
    expect(err.isConflict).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts with a timeout error once the deadline passes", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const p = fetchJson("/slow", { timeoutMs: 1000 });
    const settled = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1100);
    const err = (await settled) as ApiError;
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(true);
    vi.useRealTimers();
  });

  it("treats a 2xx with a non-JSON body as a parse error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>proxy error</html>", { status: 200 }));
    const err = (await fetchJson("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe("parse");
    expect(err.retryable).toBe(false);
  });
});

describe("error copy", () => {
  it("prefers server detail, falls back to status copy", () => {
    expect(messageFromDetail("custom", "fallback")).toBe("custom");
    expect(messageFromDetail(undefined, "fallback")).toBe("fallback");
    expect(messageFromDetail([{ loc: ["body"], msg: "bad" }], "f")).toBe("bad");
  });

  it("gives actionable copy per kind", () => {
    expect(toUserMessage(new ApiError("network", "x"))).toMatch(/Can't reach/);
    expect(toUserMessage(new ApiError("timeout", "x"))).toMatch(/too long/);
    expect(toUserMessage(new ApiError("http", "Internal server error", { status: 500 }))).toMatch(/Server error \(500\)/);
    expect(toUserMessage(new Error("plain"))).toBe("plain");
  });
});
