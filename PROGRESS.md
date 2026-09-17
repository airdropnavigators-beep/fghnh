# PROGRESS

Execution log for FlowForge. Each entry is a chunk of work with status and the files
touched. Chunks run in implementation order (spec §37). Team owners: A = technical
lead, B = frontend, C = documents/infra (see `docs/team/plan-*.md`).

Legend: ✅ done · ⏳ done pending verification · 🚧 in progress · ⬜ not started

---

## Chunk 0 — Repository init + project docs
**Owner:** A · **Status:** ✅ of [done](chunk 0)

- Created repo layout (`frontend/`, `backend/`, `infrastructure/`, `evaluation/`, `docs/`)
- `README.md`, `ARCHITECTURE.md`, `LICENSE` (MIT), `.gitignore`, `.env.example`

## Chunk 1 — Workflow contract (schema + models)
**Owner:** A · **Status:** ✅

- `backend/app/models/enums.py` — StateType/StateStatus/WorkflowStatus/DocumentStatus/
  ValidationSeverity/ValidationStatus/AuditEventType + confidence constants
- `backend/app/models/workflow.py` — `Transition`, `ValidationRule`, `State`, `Workflow`
  (all `extra="forbid"`, terminal-with-transitions rejected at model level)
- `backend/app/models/document.py` — `ExtractedField` (source_text required), documents,
  `CrossValidationResult` + issues
- `backend/app/models/audit.py`, `backend/app/models/api.py` — event + API contracts

## Chunk 2 — Workflow engine (validator + state machine + audit)
**Owner:** A · **Status:** ✅ (tests written, full run in Chunk 9)

- `backend/app/workflow/errors.py` — typed domain errors
- `backend/app/workflow/conditions.py` — closed registry of transition conditions
- `backend/app/workflow/schema_validator.py` — structural + safety checks, incl.
  approval-precedes-execution and automatic-loop rejection (Tarjan)
- `backend/app/workflow/state_machine.py` — deterministic `advance_workflow`, gated
  states, auto-chain, runtime defenses (no execution w/o approval, no duplicate exec)
- `backend/app/workflow/audit.py` — event factory
- Tests: `backend/tests/test_schema_validator.py`, `test_state_machine.py`

## Chunk 3 — AI layer (generation + controlled components)
**Owner:** A · **Status:** ✅

- `backend/app/ai/llm_provider.py` — `LLMProvider` Protocol (4 controlled ops)
- `backend/app/ai/workflow_generator.py` — generate → validate → retry once → fail
- `backend/app/ai/mock_llm_provider.py` — deterministic classifier/extractor/validator
- `backend/app/ai/bedrock_provider.py` — real Bedrock w/ retry/backoff + JSON parsing
- `backend/app/ai/prompt_utils.py` — untrusted-document delimiters (prompt-injection defense)
- `backend/prompts/*.txt` — workflow_generator, document_classifier, field_extractor,
  field_schema, cross_validator

## Chunk 4 — Persistence (repo + in-memory + dynamo)
**Owner:** A/C · **Status:** ✅

- `backend/app/storage/repository.py` — `WorkflowRepository` interface
- `backend/app/storage/in_memory.py` — demo/tests repository
- `backend/app/storage/dynamo.py` — Workflows/Documents/AuditLog tables

## Chunk 5 — Canonical demo workflow + knowledge
**Owner:** A/C · **Status:** ✅

- `backend/knowledge/scholarship_process.json` — Merit Excellence Scholarship:
  process requirements + **schema-valid** canonical workflow (10 states, 2 approval gates,
  1 execution gate, 4 terminal states). Doubles as demo fallback.

## Chunk 6 — Documents pipeline
**Owner:** C · **Status:** ✅ (interfaces + mocks + AWS adapters)

- `backend/app/documents/processor.py` — store/processor protocols
- `backend/app/documents/mock_processor.py` — fictional demo content
  (`transcript.pdf` → semester GPA 3.20 conflict; `transcript_corrected.pdf` → 3.70 pass)
- `backend/app/documents/aws_processor.py` — S3ObjectStore (AES256) + TextractProcessor
- `backend/app/services/document_service.py` — upload pipeline orchestration
- File guards (size/MIME) in API routes

## Chunk 7 — Services + API composition
**Owner:** A · **Status:** ✅

- `backend/app/services/eligibility.py` — deterministic rule evaluation
- `backend/app/services/workflow_service.py` — create/read/advance, demo handlers
  (eligibility, validation + confidence gate, simulated submission → `FF-2026-xxx`)
- `backend/app/services/demo_scenario.py` — fictional profile (Alex Rivera)
- `backend/app/api/deps.py` — composition root (DEMO_MODE switches providers/repo)
- `backend/app/api/routes.py` — the 5 spec endpoints + error mapping
- `backend/main.py` — FastAPI app, CORS, `/health`; `backend/requirements.txt`

## Chunk 8 — Tests written (not yet executed)
**Owner:** A · **Status:** ✅ (executed in Chunk 9)

- `backend/tests/test_ai.py` — generator retry/failure, mock classification/extraction,
  conflict detection, confidence gating (block at <0.60, warn 0.60–0.849)
- `backend/tests/test_api.py` — E2E demo path: create → advance → upload 4 docs →
  conflict `needs_review` → acknowledge → final approval → submission → audit trail
- `backend/additional` knowledge: canonical workflow validated on load routines

## Chunk 9 — Verify backend mock path
**Owner:** A · **Status:** ✅ done

- [x] `pytest -q` — 39 tests pass (fixed: canonical gating/message handlers, classifier
       scoring, enrollment normalization, needs-label normalization, workflow context
       emission, knowledge path, test wiring)
- [x] `ruff check app tests` — clean (`pyproject.toml` pins ruff config: E,F,I,B,W,
       line-length 120; B008 ignored for FastAPI routes)
- [x] Boot `uvicorn main:app` with `DEMO_MODE=true`, smoke `POST /workflows`
- [x] Live E2E demo verified: step1 `document_upload` → upload 4 demo docs → validation
       `needs_review` (GPA conflict, conf 0.82) → 2 approval gates → `status=completed`,
       27 audit events (incl. `human_approval` ×2, `execution`, `workflow_completed`)
- [~] Hand mock API responses to Person B (`services/mock.ts`) — frontend is starting

## Chunk 10 — Frontend scaffold
**Owner:** B · **Status:** ✅ done — running against `docs/team/plan-b-frontend.md`

- `package.json` (React 19, Vite 7, Tailwind 3.4, `@xyflow/react` v12, framer-motion,
  lucide-react; build = `tsc --noEmit && vite build`), `tsconfig.json` (`@/*` alias),
  `vite.config.ts` (`/api` proxy → `127.0.0.1:8000`), `postcss.config.js`,
  `tailwind.config.js` (ink/paper/accent/ok/warn/err tokens), `eslint.config.js` (flat),
  `index.html`, `public/favicon.svg`, `src/index.css` (panels/buttons/React Flow dark theme)
- `src/types/index.ts` — full snake_case contract mirror of `models/api.py`
- `src/services/mock.ts` — deterministic offline demo (10-state workflow, filename-driven
  classification, transcript GPA conflict, two approval gates, rejection paths, audit trail)
- `src/services/api.ts` — `FlowForgeApi` with `MockApi` (default) / `HttpApi` + env switch
- `src/utils/format.ts`, `src/utils/layout.ts`, `src/hooks/useWorkflow.ts` (phase machine)

## Chunk 11 — Workflow graph UI against mock
**Owner:** B · **Status:** ✅ done (build + lint green; interactive browser pass pending)

- `components/WorkflowGraph/` — custom `StateNode` (per-type icons, status styling, pulse on
  active) + `WorkflowGraph` (BFS layered layout, animated active edges, dots background)
- `components/GoalInput/` — goal entry with example prompts
- `components/ProgressBar/` — animated completion fill
- `pages/Demo.tsx` + `App.tsx` + `main.tsx` — header, left rail, center graph, action deck

## Chunk 12 — Document UI + approval + audit viewer
**Owner:** B (+A) · **Status:** ✅ done (build + lint green; interactive browser pass pending)

- `components/DocumentUpload/` — required-doc checklist, dropzone, demo transcript buttons,
  pipeline-stage animation, continue gate
- `components/DocumentDetails/` — extracted fields per document with confidence
- `components/ValidationResults/` — validation banner + issue cards + evidence
- `components/ApprovalModal/` — two-gate approval (acknowledge warning / final approve-reject)
- `components/ChatPanel/` (+`eventMeta.ts`) — system log feed
- `components/AuditLog/` — filterable audit trail drawer

## Chunk 13 — Evaluation + test documents
**Owner:** C · **Status:** ✅ done (mock path measured; Bedrock run pending creds)

- `evaluation/generate_test_documents.py` — stdlib PDF writer; 9 fictional, selectable-text
  documents (valid / GPA-conflict / missing-name transcript, valid / name-mismatch ID,
  valid / expired income cert, enrollment verification, personal essay)
- `evaluation/ground_truth/documents.json` — known classification, fields and validation
  scenarios per document
- `evaluation/run_evaluation.py` — 6 metrics (workflow-gen validity, classification,
  field extraction, conflict detection, generation latency, doc-processing latency),
  `--strict` gate, `--provider bedrock`, JSON results to `evaluation/results/`
- `docs/evaluation.md` — methodology, reproduction, claims/non-claims
- Fixed a real bug found by the harness: `"id" in filename` matched `valid`
  (`income_certificate_valid`); now token-based (`_identity_hint`) + regression tests
- Measured (mock): 100% workflow validity, 100% classification, 100% field extraction,
  100% conflict detection; all targets pass

## Chunk 13b — Backend production hardening + Person A docs
**Owner:** A · **Status:** ✅ done (`53 passed`, `ruff` clean, evaluation `--strict` green)

- Fixed real bug: `WorkflowService.to_detail` returned `state.type.value`
  (`document_required`/`human_approval`) instead of the normalized gate label used by
  `advance`; now both share `state_machine.needs_label` (`document_upload`/`approval`/…)
- `WorkflowService.advance` raises `WorkflowNotFound` instead of `KeyError`; routes map it
- Thread-safe confirmation ids (`threading.Lock` + `itertools.count`); removed the global
  mutable list counter
- Uploads are streamed in bounded 1 MB chunks and rejected at the limit (no full-body read)
- `_http` no longer leaks internal error strings on 500; unexpected errors are logged and
  return a generic message
- Added response models (`AdvanceWorkflowResponse`, `AuditListResponse`) + field descriptions
- `InMemoryRepository` is now thread-safe and value-isolated (copy on read/write), matching
  the DynamoDB serialization boundary
- Added `AuditEvent.event_id` (unique per event), structured logging
  (`app/core/logging_config.py`, `LOG_LEVEL`), and warning logs on mock fallbacks
- Hoisted inline imports out of route/deps functions; safe enum coercion for untrusted
  model output in `BedrockProvider`; typed `schema_validator` helpers
- New tests `backend/tests/test_production_hardening.py` (10) → suite now **53 passed**
- Person A docs: `docs/architecture.md`, `docs/ai-architecture.md`,
  `docs/workflow-engine.md`, generated `docs/api-reference.md` + `docs/openapi.json`
  via `backend/scripts/generate_api_reference.py`

## Chunk 14 — Infrastructure (SAM/Lambda/IAM) + CI/CD
**Owner:** C · **Status:** 🚧 in progress — CI ✅, SAM/Lambda/IAM ⬜

- `.github/workflows/ci.yml` — backend (ruff + pytest), frontend (lint + build),
  evaluation (generate docs + `--strict`)

## Chunk 15 — Live AWS + Bedrock verification & demo polish
**Owner:** A/C · **Status:** ⬜ — only after demo is fully safe in DEMO_MODE

---

## Current checklist (spec §45 task list)

| # | Item | Status |
| --- | --- | --- |
| 1 | Inspect repo | ✅ empty, initialized |
| 2 | Initialize structure | ✅ frontend+backend+infra+eval+docs |
| 3 | README / ARCHITECTURE / .env.example | ✅ |
| 4 | Frontend scaffold | ✅ (Chunk 10) |
| 5 | Backend scaffold | ✅ |
| 6 | Workflow JSON schema | ✅ |
| 7 | API contracts | ✅ `models/api.py` + routes |
| 8 | Pydantic models | ✅ |
| 9 | Deterministic state machine + tests | ✅ 53 tests pass (Chunk 13b) |
| 10 | Mock workflow | ✅ `knowledge/scholarship_process.json` |
| 11 | Mock API response | ✅ mock provider + in-memory repo + `services/mock.ts` |
| 12 | Frontend graph against mock | ✅ (Chunks 10–12, build + lint green) |
| 13 | Verify complete mock path | ✅ E2E scripted + live demo verified |
| 14 | Evaluation + test documents | ✅ measured (mock path, all targets pass) |
| 15 | CI/CD | ✅ `.github/workflows/ci.yml` |
| 16 | Infrastructure (SAM/Lambda/IAM) | ⬜ Chunk 14 |

## Known gaps / risks
- Live Bedrock/Textract calls unverified (no AWS creds in this workspace yet).
- Frontend built against the mock; interactive browser pass + wiring to live backend pending.
- Infrastructure (SAM/Lambda/IAM/CloudWatch) not yet written — Chunk 14 remainder.
- Evaluation numbers describe the deterministic DEMO_MODE path, not a foundation model.