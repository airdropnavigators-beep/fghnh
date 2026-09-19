import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { normalizeAdvance, normalizeAudit, normalizeDetail, normalizeUpload } from "../normalize";

const detail = {
  workflow_id: "wf_1",
  status: "in_progress",
  goal: "g",
  current_state: "a",
  progress: { completed: 1, total: 2, ratio: 0.5 },
  states: [{ id: "a", label: "A", type: "automatic", status: "active", transitions: [{ target: "b", condition: "c" }] }],
};

describe("normalize", () => {
  it("fills optional collections with defaults", () => {
    const d = normalizeDetail(detail);
    expect(d.collected_documents).toEqual([]);
    expect(d.validation).toBeNull();
    expect(d.states[0].required_documents).toEqual([]);
  });

  it("rejects payloads that are not a workflow", () => {
    expect(() => normalizeDetail({ detail: "Internal server error" })).toThrow(ApiError);
    expect(() => normalizeUpload({ detail: "Internal server error" })).toThrow(ApiError);
    expect(() => normalizeAudit({ nope: 1 })).toThrow(ApiError);
  });

  it("derives `completed` and coerces events on advance", () => {
    const a = normalizeAdvance({ ...detail, status: "completed", events: [{ event_type: "execution", details: { confirmation_id: "FF-1" } }] });
    expect(a.completed).toBe(true);
    expect(a.events[0].details.confirmation_id).toBe("FF-1");
    expect(typeof a.events[0].timestamp).toBe("string");
  });

  it("keeps extracted field shape stable", () => {
    const u = normalizeUpload({
      document_id: "d",
      filename: "t.pdf",
      classification: "academic_transcript",
      confidence: 0.75,
      extracted_fields: { gpa: { value: 3.2, confidence: 0.9 }, junk: "x" },
    });
    expect(u.extracted_fields.gpa).toEqual({ value: "3.2", confidence: 0.9, source_text: "" });
    expect(u.extracted_fields.junk).toBeUndefined();
    expect(u.issues).toEqual([]);
  });
});
