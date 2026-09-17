# PLAN — PERSON A · TECHNICAL LEAD

**Scope (spec §38):** workflow architecture, state machine, schema, workflow generation,
Bedrock + AI orchestration, validation logic, confidence system, API contracts,
backend integration, DynamoDB model, audit system, security, final integration,
architecture documentation.

Status legend: `[x] done`, `[/] in progress`, `[ ] pending`, `[~] blocked/stuck`.

---

## A1 · Workflow contract (spec §9)
- [x] Define workflow JSON schema: `workflow_id, goal, initial_state, terminal_states, states[]`
- [x] Per-state fields: `id, label, type, description, required_data, required_documents,
      validation_rules, transitions, confidence_threshold, status`
- [x] Pydantic models: `app/models/{workflow,enums,audit,document,api}.py` (strict `extra="forbid"`)
- [x] State types: automatic, user_input, document_required, validation, human_approval,
      execution, terminal (+ statuses + workflow statuses)
- [x] Transition model: `{target, condition}` with `extra="forbid"`

**DoD:** schema validated; malformed workflows rejected at model boundary. ✅

## A2 · Workflow validation (`app/workflow/schema_validator.py`)
- [x] Unique state ids, initial/terminal existence + distinctness
- [x] Every transition target exists; conditions are from a closed registry
- [x] Terminal states have no outgoing transitions; non-terminal have >= 1
- [x] Reachability of all states + reachable terminal
- [x] **No uncontrolled execution:** every path to an `execution` state passes a
      `human_approval` state (DFS over (node, approved) pairs)
- [x] No automatic-only cycles (Tarjan SCC detection); every cycle is human-gated
- [x] `ValidationReport` + `validate_or_raise`; generation retries once then fails loudly

**DoD:** all validator tests green. ✅ (`tests/test_schema_validator.py`).

## A3 · Deterministic state machine (`app/workflow/state_machine.py`)
- [x] `advance_workflow(workflow, handlers, context, inputs)` — deterministic, no LLM calls
- [x] Transition logic: `evaluate(condition, context, state)` → next state (first true)
- [x] Gated states pause: `user_input`, `document_required`, `human_approval` (needs_*)
- [x] Auto-chain of automatic/validation/execution states (loop guard MAX 20)
- [x] Safety: execution requires prior approval (runtime guard), duplicate execution refused,
      unknown/satisfied-no-transition rejected, terminal refuses further advance
- [x] Metadata/message/needs per advance for the frontend (`AdvanceResult`)

**DoD:** "cannot skip state", "cannot execute before approval", "invalid transition rejected",
"terminal works", "recovery works" — covered by tests. ✅ (`tests/test_state_machine.py`).

## A4 · Transition condition registry (`app/workflow/conditions.py`)
- [x] Closed set: always, eligibility_{passed,failed}, documents_{ready,missing},
      validation_{passed,needs_review,blocked}, approval_{granted,rejected},
      submission_complete, user_confirmed
- [x] Conditions are pure functions of `ExecutionContext` — never call the LLM

## A5 · Workflow generation (`app/ai/workflow_generator.py`, `prompts/`)
- [x] `generate()` → Pydantic parse → `validate_or_raise` → retry **once** → `workflow_generation_failed`
- [x] Canonical/fallback workflow: `knowledge/scholarship_process.json`
- [x] Generation prompt: rules, allowed state types, allowed conditions, safety rule #5
- [x] Mock seed provider for local dev + documented demo fallback

## A6 · AI orchestration (four controlled components)
- [x] `LLMProvider` interface (Protocol): generate_workflow, classify_document,
      extract_fields, run_cross_validation
- [x] `MockLLMProvider` — deterministic, no model calls (demo/tests/fallback)
- [x] `BedrockProvider` — real AWS, Anthropic JSON output, exponential backoff on throttle,
      document-as-untrusted-data delimiters (`prompt_utils.wrap_untrusted_document`)
- [ ] Verify Bedrock calls against a live model (needs AWS creds + model access)
- [x] Prompts: workflow_generator, document_classifier, field_extractor,
      field_schema, cross_validator

## A7 · Confidence system (`app/core/confidence.py`)
- [x] Thresholds: >=0.85 pass · 0.60–0.849 warn/review · <0.60 block
- [x] Gating applied in validation handler; `human_approval` always needs explicit consent
- [x] `conf` thresholds env-driven (`CONFIDENCE_PASS`, `CONFIDENCE_WARN`)

## A8 · Audit system (`app/workflow/audit.py`, `models/audit.py`)
- [x] Event model + `AuditEventType` enum (workflow_*, state_transition, document_*,
      field_extracted, validation_result, ai_decision, human_approval, execution, error)
- [x] Emitted by executor + services; persisted via repository; exposed via `GET /workflows/{id}/audit`

## A9 · Backend integration + API contracts (spec §27)
- [x] FastAPI app (`backend/main.py`), CORS, `/health`, `/`
- [x] Composition root `app/api/deps.py` — DEMO_MODE switches mock/real providers + repo
- [x] `POST /workflows`, `GET /workflows/{id}`, `POST /workflows/{id}/advance`,
      `POST /workflows/{id}/documents`, `GET /workflows/{id}/audit`
- [x] Pydantic request/response models (contract-first — frontend can build on these)
- [x] **Run `pytest` — whole suite green** (`53 passed`, `ruff` clean)
- [x] Write `docs/api-reference.md` from the live OpenAPI schema
      (`backend/scripts/generate_api_reference.py` → `docs/api-reference.md` + `docs/openapi.json`)
- [x] Production hardening pass: normalized `needs` on reads, typed not-found errors,
      non-leaking 500s, bounded uploads, thread-safe repository/IDs, structured logging

## A10 · Persistence (DynamoDB) + security
- [x] `WorkflowRepository` interface; `InMemoryRepository` (demo) + `DynamoRepository` (prod)
- [x] Dynamo logical tables: Workflows, Documents, AuditLog (PK/SK per spec §24)
- [x] Prompt injection defenses: delimiters, untrusted marking, validation of all LLM output
- [x] No autonomous consequential actions — execution simulated, always approval-gated
- [ ] AWS IAM/network hardening notes → fold into C7/C8 infra

## A11 · Documentation (owner: A)
- [x] `docs/architecture.md` (from ARCHITECTURE.md)
- [x] `docs/ai-architecture.md`
- [x] `docs/workflow-engine.md`
- [x] `docs/api-reference.md` (generated from the live OpenAPI schema)
- [x] `docs/evaluation.md` (metrics + how to measure — final numbers only from `evaluation/`)

---

**Owner notes / risks**
- Live Bedrock + Textract need credentials; keep `DEMO_MODE=true` until then — demo cannot fail.
- State-machine "recovery" = idle workflow resumed from persisted state; covered by
  `test_recovery_after_paused_state`.
- Do not add "agents". Four controlled AI components only.