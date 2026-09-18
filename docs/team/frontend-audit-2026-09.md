# Frontend audit — interactive browser pass (Sept 2026)

Baseline: `frontend/` at upstream `0be06e1`, run against `services/mock.ts` and against the
live FastAPI backend (`DEMO_MODE=true`, `uvicorn main:app` on :8000, Vite `/api` proxy).
Screens exercised: goal → graph → document upload (×4, incl. demo transcript) → validation
conflict → acknowledge → final approval → submission → audit drawer, plus rejection paths.

## Broken / dead-ended

| # | Where | Finding |
| --- | --- | --- |
| 1 | `ApprovalModal` | `onClose={() => {}}` — X button, backdrop and Escape do nothing. Validation evidence behind the modal is blurred and unreachable. Dead end. |
| 2 | `useWorkflow.phaseFor` | Any `needs` other than `document_upload`/`approval` (backend also emits `user_input` and `action`) falls back to the goal screen while a workflow is running. |
| 3 | `useWorkflow` / `AuditLog` | Audit list built by prepending each response batch (`[...res.events, ...prev]`) → batches newest-first but events inside each batch oldest-first; auto-scroll lands on "Workflow created". |
| 4 | `services/mock.ts` | `advance()` never appends its events to `session.audit`, so `listAudit()` (the "refresh" path) drops every state transition/approval/execution event. |
| 5 | `HttpApi` | No timeout, no retry, no handling of FastAPI validation errors (`detail` is an array → rendered as `[object Object]`), no distinction between network failure and HTTP status. |
| 6 | Live backend | `execution` audit event carries `{confidence}` only — no `confirmation_id` (that lives in the executor's transient `ctx.results`). Frontend showed the fake fallback `FF-2026-demo`. |
| 7 | Live backend | `workflow_created` / `workflow_generated` events exist only in `GET /audit`; frontend synthesised a local `workflow_created` instead of syncing. |
| 8 | `DocumentUpload` | Required documents hard-coded to state id `document_collection`; unknown/unclassifiable uploads (mock: `classification: null`) are silently accepted with no feedback. |
| 9 | `WorkflowGraph` | Initial state hard-coded to `eligibility_check` (only correct for the scholarship workflow). |
| 10 | `Demo.tsx` | Floating "Open audit trail" button overlaps the right panel content (extracted-fields table). |
| 11 | `Demo.tsx` | Left rail: `SideRail` and `ChatPanel` both `h-full` inside a flex column → panels overlap; "WORKFLOW STATUS" renders underneath "SYSTEM LOG". |
| 12 | `ProgressBar` | Completed workflow reports `7 of 10 · 70%` because alternative terminal states (`not_eligible`, `blocked`, `cancelled`) are never visited. |
| 13 | `DocumentDetails` | Classification confidence always rendered green (`text-ok`) regardless of value (live backend returns 0.75 for transcripts). |
| 14 | `Demo.tsx` | Error banner lives in the right aside, which is empty on the goal screen → errors during workflow creation appear detached from the form. |
| 15 | Layout | Fixed `w-72` + `w-[380px]` asides; below ~1100px the graph collapses to a sliver, nothing reflows on tablet/mobile. |
| 16 | `ApprovalModal` | No `role="dialog"`, focus trap or Escape handling. |

## Unstyled / placeholder

- Graph nodes render at ~0.35 zoom (6 wide columns) — the centrepiece looks like a thumbnail.
- No loading state for workflow generation (button text only), no skeletons, no empty state for
  documents/audit beyond one line of muted text, no connection state for the live API.
- No visual distinction between mock and live mode.
- Status chip in header uses raw enum text (`in progress`).

## Fixed in Chunk 16 (see PROGRESS.md)

All rows above are addressed by the redesign + live wiring in Chunk 16.
