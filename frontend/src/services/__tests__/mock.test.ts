import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { mockApi, resetMock, setMockLatency } from "../mock";

const pdf = (name: string) => new File([`%PDF ${name}`], name, { type: "application/pdf" });

async function toValidation(transcript = "transcript.pdf") {
  const created = await mockApi.createWorkflow("Apply for the Merit Excellence Scholarship");
  const id = created.workflow_id;
  await mockApi.advance(id, {});
  for (const f of [transcript, "government_id.pdf", "income_certificate.pdf", "essay.pdf"]) {
    await mockApi.uploadDocument(id, pdf(f));
  }
  return { id, res: await mockApi.advance(id, {}) };
}

describe("mock backend parity", () => {
  beforeEach(() => {
    resetMock();
    setMockLatency(0);
  });

  it("pauses at the review gate, then at the final gate (one decision per advance)", async () => {
    const { id, res } = await toValidation();
    expect(res.needs).toBe("approval");
    expect(res.current_state).toBe("review_warnings");
    expect(res.validation?.status).toBe("needs_review");

    const afterAck = await mockApi.advance(id, { acknowledge: true });
    expect(afterAck.current_state).toBe("final_approval");
    expect(afterAck.needs).toBe("approval");
    expect(afterAck.status).toBe("in_progress");

    const done = await mockApi.advance(id, { approval: true });
    expect(done.status).toBe("completed");
    expect(done.events.map((e) => e.event_type)).toContain("execution");
    expect(done.events.at(-1)?.event_type).toBe("workflow_completed");
  });

  it("skips the review gate with a corrected transcript", async () => {
    const { res } = await toValidation("transcript_corrected.pdf");
    expect(res.current_state).toBe("final_approval");
    expect(res.validation?.status).toBe("pass");
  });

  it("records every advance event in the audit trail", async () => {
    const { id } = await toValidation();
    const audit = await mockApi.listAudit(id);
    const types = audit.events.map((e) => e.event_type);
    expect(types[0]).toBe("workflow_created");
    expect(types).toContain("state_transition");
    expect(types).toContain("document_uploaded");
  });

  it("errors like the backend on unknown ids and finished workflows", async () => {
    await expect(mockApi.getWorkflow("wf_missing")).rejects.toMatchObject({ status: 404 });
    const { id } = await toValidation("transcript_corrected.pdf");
    await mockApi.advance(id, { approval: false });
    const err = (await mockApi.advance(id, {}).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
  });
});
