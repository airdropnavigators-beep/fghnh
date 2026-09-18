import { describe, expect, it } from "vitest";
import type { AuditEvent, WorkflowDetail } from "@/types";
import { confirmationFrom, mergeEvents, phaseFor } from "../useWorkflow";

const base: WorkflowDetail = {
  workflow_id: "wf_abc123",
  status: "in_progress",
  goal: "g",
  current_state: "review_warnings",
  needs: "approval",
  progress: { completed: 3, total: 10, ratio: 0.3 },
  collected_documents: [],
  validation: { status: "needs_review", confidence: 0.82, issues: [], suggestions: [], checked_documents: [] },
  states: [
    { id: "document_collection", label: "Docs", type: "document_required", description: "", required_data: [], required_documents: [], transitions: [], status: "completed" },
    {
      id: "review_warnings",
      label: "Review",
      type: "human_approval",
      description: "",
      required_data: [],
      required_documents: [],
      transitions: [
        { target: "final_approval", condition: "approval_granted" },
        { target: "document_collection", condition: "approval_rejected" },
      ],
      status: "active",
    },
    { id: "final_approval", label: "Approve", type: "human_approval", description: "", required_data: [], required_documents: [], transitions: [], status: "pending" },
  ],
};

describe("phaseFor", () => {
  it("detects the warning gate structurally, not by state id", () => {
    expect(phaseFor(base)).toBe("review");
    expect(phaseFor({ ...base, current_state: "final_approval", validation: { ...base.validation!, status: "pass" } })).toBe("approval");
  });
  it("maps every backend gate label", () => {
    expect(phaseFor({ ...base, needs: "document_upload" })).toBe("documents");
    expect(phaseFor({ ...base, needs: "user_input" })).toBe("input");
    expect(phaseFor({ ...base, needs: "action" })).toBe("approval");
    expect(phaseFor({ ...base, status: "cancelled", needs: null })).toBe("done");
    expect(phaseFor(null)).toBe("goal");
  });
});

describe("mergeEvents", () => {
  const ev = (t: string, type: AuditEvent["event_type"], id?: string): AuditEvent => ({
    event_id: id,
    timestamp: t,
    workflow_id: "w",
    event_type: type,
    details: {},
  });
  it("sorts chronologically and de-duplicates by id or content", () => {
    const merged = mergeEvents(
      [ev("2026-01-01T00:00:02Z", "execution", "b"), ev("2026-01-01T00:00:01Z", "workflow_created", "a")],
      [ev("2026-01-01T00:00:01Z", "workflow_created", "a"), ev("2026-01-01T00:00:03Z", "workflow_completed")],
    );
    expect(merged.map((e) => e.event_type)).toEqual(["workflow_created", "execution", "workflow_completed"]);
  });
});

describe("confirmationFrom", () => {
  it("prefers the server's confirmation id, otherwise derives one only after execution", () => {
    expect(confirmationFrom([{ timestamp: "", workflow_id: "w", event_type: "execution", details: { confirmation_id: "FF-9" } }], "wf_x")).toBe("FF-9");
    expect(confirmationFrom([{ timestamp: "", workflow_id: "w", event_type: "execution", details: {} }], "wf_e0245c64a40e")).toMatch(/^FF-\d{4}-64A40E$/);
    expect(confirmationFrom([], "wf_x")).toBeUndefined();
  });
});
