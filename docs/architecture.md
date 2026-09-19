# FlowForge Architecture

> **The LLM plans. The state machine executes. The human stays in control.**

FlowForge is a **domain-agnostic agentic workflow engine**. The Merit Excellence
Scholarship is only the demo use case: the same engine can drive insurance claims,
reimbursements, college applications, or government services without changing the core.
This document is the technical reference for the backend. For the top-level overview see
[`ARCHITECTURE.md`](../ARCHITECTURE.md); for the AI layer see
[`ai-architecture.md`](./ai-architecture.md); for the execution contract see
[`workflow-engine.md`](./workflow-engine.md); for the HTTP surface see
[`api-reference.md`](./api-reference.md).

## 1. Design principle

FlowForge is not "an AI chatbot that answers questions". It separates the
non-deterministic part of the problem (understanding a goal, reading documents) from the
deterministic part (deciding what happens next, enforcing order, gating consequential
actions). The LLM produces a **plan only**; it never selects a runtime transition.

| Layer | Responsibility | Determinism |
| --- | --- | --- |
| Workflow Planning LLM | goal → structured workflow JSON | non-deterministic |
| Schema Validator | reject malformed/unsafe plans before execution | deterministic |
| State Machine | execute transitions, enforce order and approval gates | deterministic |
| Document Pipeline | classify, extract fields, cross-validate | AI analysis + rule gates |
| Human Approval | approve/deny consequential actions | human |
| Audit Log | record every meaningful event | deterministic |

## 2. Runtime topology

```
                        ┌─────────────────────────────┐
   browser (React)  ───▶ │  FastAPI app (backend/main) │
                        │  app/api/routes.py          │
                        └──────────────┬──────────────┘
                                       │ Depends(get_services)
                        ┌──────────────▼──────────────┐
                        │  app/api/deps.py (root)     │
                        │  DEMO_MODE ? mock : AWS     │
                        └──────┬───────────────┬──────┘
                               │               │
                 ┌─────────────▼──┐     ┌──────▼───────────────┐
                 │ WorkflowService│     │ DocumentService      │
                 │ state machine  │     │ upload→classify→extract│
                 └───┬────────┬───┘     └───────┬──────────────┘
                     │        │                 │
        ┌────────────▼──┐  ┌──▼─────────┐  ┌────▼─────────────┐
        │ LLMProvider    │  │ Repository │  │ Store + Processor│
        │ Bedrock / Mock │  │ Dynamo/InMem│ │ S3/Textract/Mock │
        └────────────────┘  └────────────┘  └──────────────────┘
```

`app/api/deps.py` is the composition root. It inspects `DEMO_MODE` and constructs either
the mock stack (no AWS, deterministic, used for the demo and tests) or the AWS stack.
The interface boundaries (`LLMProvider`, `WorkflowRepository`, `DocumentObjectStore`,
`DocumentProcessor`) are identical in both, so the application code is portable.

## 3. Component map

| Path | Responsibility |
| --- | --- |
| `backend/main.py` | FastAPI app, CORS, `/health`, `/`, logging setup |
| `backend/app/api/routes.py` | Thin HTTP layer: validation, error mapping, response models |
| `backend/app/api/deps.py` | Composition root; provider/repository selection |
| `backend/app/services/workflow_service.py` | Orchestrates generation + state machine + handlers |
| `backend/app/services/document_service.py` | Upload → store → extract text → classify → extract fields |
| `backend/app/services/eligibility.py` | Deterministic eligibility rule evaluation |
| `backend/app/workflow/state_machine.py` | Deterministic executor (`advance_workflow`) |
| `backend/app/workflow/conditions.py` | Closed registry of transition predicates |
| `backend/app/workflow/schema_validator.py` | Structural + safety validation of generated plans |
| `backend/app/ai/*` | `LLMProvider`, `BedrockProvider`, `MockLLMProvider`, prompts |
| `backend/app/models/*` | Pydantic contracts (workflow, document, audit, API, enums) |
| `backend/app/storage/*` | `WorkflowRepository` + DynamoDB / in-memory implementations |
| `backend/app/documents/*` | `DocumentObjectStore` / `DocumentProcessor` + AWS / mock implementations |
| `backend/app/core/*` | Config, logging, confidence gating |

## 4. Request lifecycle

### 4.1 Create

```
POST /workflows {goal}
  → workflow_service.create_workflow(goal)
      → audit: workflow_created
      → WorkflowGenerator.generate(goal, knowledge)
          → LLMProvider.generate_workflow()          (Bedrock or canonical mock)
          → Workflow.model_validate()                (strict pydantic)
          → schema_validator.validate_or_raise()     (structural + safety)
          → retry exactly once on failure
      → audit: workflow_generated
      → repository.save_workflow()
  → 200 {workflow_id, status, workflow}
```

An invalid plan is **never executed**. If generation + one retry fail the request returns
`409` and a terminal `workflow_generation_failed` outcome is recorded.

### 4.2 Advance

```
POST /workflows/{id}/advance {approval|acknowledge|user_input|confirm}
  → workflow_service.advance(id, inputs)
      → repository.get_workflow(id)            (404 if missing)
      → build ExecutionContext (collected docs + persisted collected_data)
      → build handlers for automatic/validation/execution states
      → state_machine.advance_workflow(...)     (pure, deterministic)
      → persist workflow + emitted audit events
  → 200 AdvanceWorkflowResponse {…detail, message, completed, events}
```

`GET /workflows/{id}` returns the same `WorkflowDetailResponse` shape, including the
normalized `needs` label, so the frontend can render from either endpoint identically.

### 4.3 Upload

```
POST /workflows/{id}/documents (multipart file)
  → size checked while streaming (413 if over MAX_DOCUMENT_SIZE_MB)
  → MIME validated (415 in non-demo mode)
  → DocumentService.process_upload()
      → object store put (S3 or mock)
      → processor extract_text (Textract or mock)
      → LLMProvider.classify_document()
      → LLMProvider.extract_fields()
  → 200 DocumentUploadResponse
```

## 5. State machine

The executor advances one logical step, auto-chaining deterministic states
(`automatic`, `validation`, `execution`) and pausing at any gated state
(`user_input`, `document_required`, `human_approval`). Details and the full contract live
in [`workflow-engine.md`](./workflow-engine.md).

Safety guarantees enforced at runtime (in addition to static validation):

- execution states cannot be entered without a prior `human_approval` in the same run;
- an execution state cannot be executed twice;
- terminal workflows reject further `advance` calls;
- a completed state with no satisfied transition is an error, never a silent stall;
- the automatic chain is bounded (`MAX_AUTOMATIC_CHAIN = 20`).

## 6. Persistence

`WorkflowRepository` is the only storage abstraction. `InMemoryRepository` is used in
demo/test mode and is thread-safe with copy-on-read/write value isolation, so it behaves
like a serialization boundary. `DynamoRepository` maps the same model to three logical
tables.

```
Workflows   PK: workflowId                    goal, status, currentState, states,
                                              collectedData, createdAt, updatedAt
Documents   PK: workflowId / SK: documentId   s3Key, filename, mimeType, classification,
                                              extractedFields, validation*,
                                              uploadedAt, processedAt
AuditLog    PK: workflowId / SK: timestamp    eventId, eventType, fromState, toState,
                                              confidence, details
```

Environment: `AWS_DYNAMODB_TABLE_WORKFLOWS`, `AWS_DYNAMODB_TABLE_DOCUMENTS`,
`AWS_DYNAMODB_TABLE_AUDIT`, `AWS_S3_BUCKET`, `BEDROCK_REGION`.

## 7. Configuration

All configuration is environment-driven (`app/core/config.py`) and read once via a
cached `get_settings()`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEMO_MODE` | `true` | Use mock LLM/repository/document stack (no AWS needed) |
| `ENVIRONMENT` | `development` | Reported by `/health` |
| `LOG_LEVEL` | `INFO` | Root logger level |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed browser origins |
| `MAX_DOCUMENT_SIZE_MB` | `10` | Upload size limit |
| `ALLOWED_MIME_TYPES` | pdf/png/jpeg | Upload MIME allow-list (enforced in every mode) |
| `TEXTRACT_SYNC_MAX_BYTES` | 5 MB | PNG/JPEG up to this size use `DetectDocumentText(Bytes)`; PDFs and larger files use the asynchronous S3 job |
| `TEXTRACT_ASYNC_POLL_SECONDS` / `TEXTRACT_ASYNC_TIMEOUT_SECONDS` | 1.5 / 60 | Polling cadence and deadline for asynchronous Textract jobs |
| `RECORD_RETENTION_DAYS` | 0 | DynamoDB TTL for workflow/document/audit rows (0 = keep) |
| `CONFIDENCE_PASS` / `CONFIDENCE_WARN` | `0.85` / `0.60` | Confidence gates |
| `BEDROCK_MODEL_ID` | Claude 3.5 Sonnet | Workflow generation + cross-validation |
| `BEDROCK_FAST_MODEL_ID` | Claude 3.5 Haiku | Classification + field extraction |
| `BEDROCK_MAX_RETRIES` / `BEDROCK_RETRY_BASE_SECONDS` | `3` / `1.0` | Throttle backoff |

**Fail-safe behavior:** in non-demo mode, if a provider or repository cannot be
constructed the composition root logs a warning and falls back to the mock
implementation, so a live demo degrades rather than crashes.

## 8. Errors and observability

- Domain errors live in `app/workflow/errors.py`. Routes map them to HTTP status
  (`404` not found, `409` terminal/generation failure, `422` invalid transition,
  `413` oversize upload, `415` bad MIME).
- Unexpected exceptions become a generic `500 {"detail": "Internal server error"}`;
  the internal message is logged, never returned to the client.
- Structured stdout logging is configured once in `app/core/logging_config.py`.
- Every meaningful action emits an `AuditEvent` with a unique `event_id`, exposed via
  `GET /workflows/{id}/audit`.

## 9. Security stance

- **Prompt injection:** document text is treated as data, wrapped in explicit
  `<document_content>` delimiters, and marked untrusted (`ai/prompt_utils.py`).
- **No arbitrary actions:** an LLM can only reference the closed condition registry;
  unknown conditions fail schema validation.
- **Human in the loop:** no consequential action executes without a prior approval gate;
  demo submission is simulated.
- **Least privilege:** S3 objects are private and server-side encrypted; keys are
  generated server-side; uploads are MIME- and size-checked.
- **No real data:** all demo documents and profiles are fictional.

## 10. Deployment

Target is serverless: API Gateway + Lambda running the same FastAPI app, S3 for
documents, DynamoDB for state, Bedrock for model calls (see `infrastructure/` and
[`plan-c-infrastructure.md`](./team/plan-c-infrastructure.md)). Because storage and AI
are behind interfaces, the identical application code runs locally with `DEMO_MODE=true`.

## 11. References

- [`workflow-engine.md`](./workflow-engine.md) — contract, conditions, executor
- [`ai-architecture.md`](./ai-architecture.md) — controlled AI components
- [`api-reference.md`](./api-reference.md) — generated HTTP reference
- [`evaluation.md`](./evaluation.md) — metrics and methodology
