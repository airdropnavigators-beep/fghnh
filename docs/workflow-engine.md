# FlowForge Workflow Engine

The workflow engine is deliberately **dumb**: it executes a validated plan, step by step,
and never invokes an LLM to decide what happens next. This document is the contract for
workflow authors, the validator, and the executor.

See [`architecture.md`](./architecture.md) for the system view and
[`ai-architecture.md`](./ai-architecture.md) for how plans are generated.

## 1. When a workflow runs

```
goal → LLM plan → schema validation → (retry once) → execution
```

An invalid plan is never executed. If generation and one retry both fail, the workflow
ends in `workflow_generation_failed` (HTTP `409`).

## 2. The workflow contract

Defined by `app/models/workflow.py` (Pydantic, `extra="forbid"`):

```jsonc
{
  "workflow_id": "wf_scholarship_merit_excellence",
  "goal": "I want to apply for the Merit Excellence Scholarship",
  "initial_state": "eligibility_check",
  "terminal_states": ["completed", "not_eligible", "blocked", "cancelled"],
  "states": [
    {
      "id": "document_collection",
      "label": "Documents",
      "type": "document_required",
      "description": "Upload your academic transcript, ...",
      "required_data": [],                       // user_input states
      "required_documents": [                    // document_required states
        "academic_transcript", "government_id",
        "proof_of_income", "personal_essay"
      ],
      "validation_rules": [],                    // declarative rules (validation states)
      "confidence_threshold": 0.85,
      "transitions": [
        { "target": "document_validation", "condition": "documents_ready" }
      ]
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `workflow_id` | Assigned server-side (`wf_<hex>`) at creation |
| `initial_state` | Must exist and must not be terminal |
| `terminal_states` | Non-empty; every listed id must exist |
| `states[].id` | Unique |
| `states[].type` | One of the state types below |
| `transitions[].target` | Must reference an existing state |
| `transitions[].condition` | Must be in the closed registry (§4) |

## 3. State types

| Type | Behavior when reached | Gated? |
| --- | --- | --- |
| `automatic` | Runs a deterministic application handler (e.g. eligibility) | no |
| `validation` | Runs cross-document validation (AI analysis + rule gate) | no |
| `execution` | Performs the consequential action (simulated in demo) | no (but guarded) |
| `user_input` | Waits for `user_input` values matching `required_data` | **yes** |
| `document_required` | Waits until `required_documents` are all collected | **yes** |
| `human_approval` | Waits for an explicit `approval` / `acknowledge` decision | **yes** |
| `terminal` | Ends the workflow (`completed` or `cancelled`) | n/a |

Statuses per state: `pending`, `active`, `completed`, `warning`, `blocked`, `failed`,
`skipped`. Workflow statuses: `created`, `in_progress`, `blocked`,
`generation_failed`, `completed`, `failed`, `cancelled`.

## 4. Condition registry (closed set)

Conditions are pure functions of the execution context (`app/workflow/conditions.py`).
They never call the LLM.

| Condition | True when |
| --- | --- |
| `always` | always |
| `eligibility_passed` / `eligibility_failed` | eligibility handler result |
| `documents_ready` / `documents_missing` | required docs ⊆ / ⊄ collected |
| `validation_passed` | validation result `status == pass` |
| `validation_needs_review` | validation result `status == needs_review` |
| `validation_blocked` | validation result `status == block` |
| `approval_granted` / `approval_rejected` | current approval state's decision |
| `submission_complete` | submission handler result |
| `user_confirmed` | advance request carries `confirm` or `acknowledge` |

The executor evaluates a state's transitions in order and takes the **first true**
condition. If none is true, that is an error (`ExecutionError`), never a silent stall.

## 5. Static validation (`schema_validator.py`)

Every generated workflow must pass all checks before it can run:

1. unique state ids;
2. `initial_state` exists, is not terminal, and terminal states exist/are distinct;
3. every transition target exists;
4. terminal states have no outgoing transitions; non-terminal states have at least one;
5. every transition condition is in the closed registry;
6. every state is reachable from the initial state;
7. at least one terminal state is reachable;
8. **no uncontrolled execution** — every path to an `execution` state passes a
   `human_approval` state first (DFS over `(node, approved)` pairs);
9. **no automatic-only cycles** — every cycle contains at least one human-gated state
   (Tarjan SCC detection), preventing an autonomous infinite loop.

## 6. Executor algorithm

`advance_workflow(workflow, handlers, context, inputs)` mutates the workflow in place and
returns an `AdvanceResult` (`workflow`, `events`, `needs`, `message`, `completed`).

```
if workflow is terminal: raise WorkflowAlreadyTerminalError

current = active state, or activate the initial state

loop (bounded by MAX_AUTOMATIC_CHAIN = 20):
    if current is terminal: finish (completed or cancelled) and return

    result = run current state
        - automatic/validation/execution → registered application handler
        - user_input / document_required / human_approval → built-in gate logic
    if result is not "completed":
        mark state active/blocked/failed, set needs label, pause and return

    persist result; mark current completed; emit execution audit if applicable
    choose next = first transition whose condition is true
    if next is execution:
        refuse if already executed
        refuse unless an approval has been granted in this run
    activate next; current = next
    if next is gated: pause and return

raise ExecutionError (loop guard exceeded)
```

`needs` is normalized to a stable client label by `state_machine.needs_label()`:
`user_input`, `document_upload`, `approval`, or `action`. `WorkflowService.to_detail`
uses the same helper, so `POST /advance` and `GET /workflows/{id}` always agree.

## 7. Safety guarantees

| Guarantee | Where enforced |
| --- | --- |
| Cannot skip a state / jump to submission | static reachability + runtime transitions |
| Cannot execute before approval | static check #8 + runtime `context.approved` guard |
| Cannot execute twice | runtime duplicate-execution guard |
| Cannot loop without a human | static check #9 + `MAX_AUTOMATIC_CHAIN` |
| Terminal is final | `WorkflowAlreadyTerminalError` on further advance |
| No LLM in control flow | executor reads only context/results |

## 8. Audit events

Emitted by the executor and services, persisted via the repository, exposed by
`GET /workflows/{id}/audit`. Each event has a unique `event_id` and ISO-8601 `timestamp`.

`workflow_created`, `workflow_generated`, `workflow_validated`, `state_activated`,
`state_transition`, `document_uploaded`, `document_classified`, `field_extracted`,
`validation_result`, `ai_decision`, `human_approval`, `execution`, `error`,
`workflow_completed`.

## 9. Demo trace (happy path)

For the Merit Excellence Scholarship with the canonical mock plan:

```
create            → workflow_created, workflow_generated
advance {}        → eligibility_check runs (eligible) → document_collection active
                    needs = document_upload
upload ×4         → academic_transcript, government_id, proof_of_income, personal_essay
advance {}        → documents_ready → document_validation runs
                    transcript semester GPA 3.20 < 3.50 ⇒ needs_review
                    → review_warnings active, needs = approval
advance {acknowledge:true} → review_warnings completed → final_approval, needs = approval
advance {approval:true}    → submission executes → completed
                    audit includes human_approval + execution + workflow_completed
```

Uploading `transcript_corrected.pdf` (semester GPA 3.70) instead passes validation and
goes straight to `final_approval`. See [`evaluation.md`](./evaluation.md) for the
measured metrics over the test-document corpus.
