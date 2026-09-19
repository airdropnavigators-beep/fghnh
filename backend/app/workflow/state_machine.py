"""Deterministic workflow executor.

This is intentionally "dumb". The intelligence lives in planning (LLM) and analysis
(validators/extractors); execution is a pure deterministic function of
(current_state, execution_result) -> next_state.

The executor never asks the LLM what to do next.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from pydantic import BaseModel, Field

from ..models.api import AdvanceWorkflowRequest
from ..models.audit import AuditEvent
from ..models.enums import (
    AuditEventType,
    StateStatus,
    StateType,
    WorkflowStatus,
)
from ..models.workflow import State, Workflow
from .conditions import evaluate
from .errors import (
    ExecutionError,
    InvalidTransitionError,
    WorkflowAlreadyTerminalError,
)

MAX_AUTOMATIC_CHAIN = 20


class StepResult(BaseModel):
    """Result of executing one state."""

    status: str = Field(
        description="completed | needs_input | needs_document | needs_approval | blocked | failed"
    )
    data: dict[str, Any] = Field(default_factory=dict)
    message: Optional[str] = None
    confidence: Optional[float] = None


class StepHandler(Protocol):
    """Application-provided handler for automatic/validation/execution states.

    Handlers are deterministic application logic; they are where any AI-produced
    analysis is consumed as *data*, never as executable instructions.
    """

    def execute(self, state: State, context: "ExecutionContext") -> StepResult:
        ...


StepHandlerMap = dict[str, StepHandler]


class ExecutionContext(BaseModel):
    """Everything the executor may look at. No LLM calls happen here."""

    data: dict[str, Any] = Field(default_factory=dict)
    collected_documents: dict[str, Any] = Field(default_factory=dict)
    results: dict[str, dict[str, Any]] = Field(default_factory=dict)
    inputs: Optional[AdvanceWorkflowRequest] = None
    approved: bool = False


@dataclass
class AdvanceResult:
    workflow: Workflow
    events: list[AuditEvent] = field(default_factory=list)
    needs: Optional[str] = None
    message: Optional[str] = None
    active_state_id: Optional[str] = None
    completed: bool = False


def _find_active(workflow: Workflow) -> Optional[State]:
    for s in workflow.states:
        if s.status == StateStatus.ACTIVE:
            return s
    return None


def advance_workflow(
    workflow: Workflow,
    handlers: StepHandlerMap,
    context: ExecutionContext,
    inputs: Optional[AdvanceWorkflowRequest] = None,
) -> AdvanceResult:
    """Advance the workflow one logical step (which may auto-run a chain of
    automatic/validation/execution states). Mutates `workflow` in place."""

    if workflow.status in {
        WorkflowStatus.COMPLETED,
        WorkflowStatus.GENERATION_FAILED,
        WorkflowStatus.CANCELLED,
        WorkflowStatus.FAILED,
    }:
        raise WorkflowAlreadyTerminalError(f"workflow '{workflow.workflow_id}' is already finished")

    context.inputs = inputs
    result = AdvanceResult(workflow=workflow)
    seen = {s.id for s in workflow.states if s.status != StateStatus.PENDING}

    current = _find_active(workflow)
    if current is None:
        current = workflow.get_state(workflow.initial_state)
        if current is None:
            raise ExecutionError(f"initial state '{workflow.initial_state}' not found")
        _activate(workflow, current, result)

    steps = 0
    while steps <= MAX_AUTOMATIC_CHAIN:
        steps += 1
        if current.type == StateType.TERMINAL:
            return _finish_terminal(workflow, current, context, result)

        step = _run_state(workflow, current, handlers, context, result)
        if step.status != "completed":
            result.needs = needs_label(current) if _is_waiting(step.status) else step.status
            result.message = step.message
            result.active_state_id = current.id
            if step.status == "blocked":
                _set(workflow, current, StateStatus.BLOCKED)
            elif step.status == "failed":
                _set(workflow, current, StateStatus.FAILED)
            else:
                _set(workflow, current, StateStatus.ACTIVE)
            workflow.current_state = current.id
            workflow.status = WorkflowStatus.IN_PROGRESS
            workflow.touch()
            return result

        context.results[current.id] = step.data
        seen.add(current.id)
        _set(workflow, current, StateStatus.COMPLETED)
        _record_state_done(workflow, current, step, result)

        # ----- choose the next state (deterministic) -----
        if current.type == StateType.USER_INPUT and step.data:
            workflow.collected_data.update(step.data)
        if current.type == StateType.HUMAN_APPROVAL:
            if step.data.get("approved"):
                context.approved = True

        nxt_id = _pick_transition(workflow, current, context)
        nxt = workflow.get_state(nxt_id)
        if nxt is None:
            raise InvalidTransitionError(
                f"state '{current.id}' transitioned to unknown state '{nxt_id}'"
            )

        _emit(
            workflow,
            result,
            AuditEventType.STATE_TRANSITION,
            from_state=current.id,
            to_state=nxt.id,
        )

        # ----- safety: don't allow re-visiting a completed execution state -----
        if nxt.type == StateType.EXECUTION and nxt.id in context.results:
            raise ExecutionError(
                f"execution state '{nxt.id}' has already been executed (duplicate execution blocked)"
            )
        if nxt.type == StateType.EXECUTION and not context.approved:
            raise InvalidTransitionError(
                f"refusing to enter execution state '{nxt.id}' without prior human approval"
            )

        _activate(workflow, nxt, result)
        current = nxt

        if current.type == StateType.TERMINAL:
            return _finish_terminal(workflow, current, context, result)

        if current.type not in {StateType.AUTOMATIC, StateType.VALIDATION, StateType.EXECUTION}:
            # gated state: pause and wait for the human
            result.needs = needs_label(current)
            result.message = current.description
            result.active_state_id = current.id
            workflow.current_state = current.id
            workflow.status = WorkflowStatus.IN_PROGRESS
            workflow.touch()
            return result

    raise ExecutionError("automatic execution exceeded max steps (possible uncontrolled loop)")


def _run_state(
    workflow: Workflow,
    state: State,
    handlers: StepHandlerMap,
    context: ExecutionContext,
    result: AdvanceResult,
) -> StepResult:
    if state.type == StateType.USER_INPUT:
        return _handle_user_input(state, context, result)
    if state.type == StateType.DOCUMENT_REQUIRED:
        return _handle_documents(state, context)
    if state.type == StateType.HUMAN_APPROVAL:
        return _handle_approval(workflow, state, context, result)
    handler = handlers.get(state.id)
    if handler is None:
        raise ExecutionError(f"no handler registered for state '{state.id}' ({state.type})")
    if callable(handler):
        return handler(state, context)
    return handler.execute(state, context)


def _handle_user_input(
    state: State, context: ExecutionContext, result: AdvanceResult
) -> StepResult:
    if context.inputs is None or not context.inputs.user_input:
        return StepResult(status="needs_input", message=state.description)
    data = dict(context.inputs.user_input)
    required = set(state.required_data)
    if not required.issubset(set(data)):
        missing = sorted(required - set(data))
        return StepResult(
            status="needs_input",
            message=f"missing required input: {', '.join(missing)}",
            data=data,
        )
    return StepResult(status="completed", data=data)


def _handle_documents(state: State, context: ExecutionContext) -> StepResult:
    required = set(state.required_documents)
    present = set(context.collected_documents)
    missing = sorted(required - present)
    if not missing:
        return StepResult(status="completed", data={"documents": sorted(present)})
    return StepResult(
        status="needs_document",
        message=f"Upload required documents: {', '.join(missing)}",
        data={"missing_documents": missing},
    )


def _handle_approval(
    workflow: Workflow, state: State, context: ExecutionContext, result: AdvanceResult
) -> StepResult:
    approved = _read_approval(context)
    if approved is None:
        return StepResult(
            status="needs_approval",
            message=state.description,
            data=context.results.get(state.id, {}),
        )
    _emit(
        workflow,
        result,
        AuditEventType.HUMAN_APPROVAL,
        from_state=state.id,
        confidence=None,
        details={"approved": approved, "state": state.id},
    )
    return StepResult(status="completed", data={"approved": approved})


def _read_approval(context: ExecutionContext) -> Optional[bool]:
    if context.inputs is None:
        return None
    if context.inputs.approval is not None:
        return context.inputs.approval
    if context.inputs.acknowledge is not None:
        return context.inputs.acknowledge
    return None


def _pick_transition(workflow: Workflow, state: State, context: ExecutionContext) -> str:
    for tr in state.transitions:
        if evaluate(tr.condition, context, state):
            return tr.target
    raise ExecutionError(
        f"state '{state.id}' completed but no outgoing transition condition was satisfied"
    )


def _finish_terminal(
    workflow: Workflow, terminal: State, context: ExecutionContext, result: AdvanceResult
) -> AdvanceResult:
    _set(workflow, terminal, StateStatus.COMPLETED)
    workflow.current_state = terminal.id
    if _is_cancel_terminal(terminal):
        workflow.status = WorkflowStatus.CANCELLED
    else:
        workflow.status = WorkflowStatus.COMPLETED
    workflow.touch()
    _emit(
        workflow,
        result,
        AuditEventType.WORKFLOW_COMPLETED,
        from_state=terminal.id,
        to_state=terminal.id,
        details={"final_status": workflow.status.value},
    )
    result.completed = True
    result.message = "Workflow completed"
    result.active_state_id = terminal.id
    return result


def _is_cancel_terminal(terminal: State) -> bool:
    return "cancel" in terminal.id.lower() or "cancel" in terminal.label.lower()


def _activate(workflow: Workflow, state: State, result: AdvanceResult) -> None:
    _set(workflow, state, StateStatus.ACTIVE)
    _emit(
        workflow,
        result,
        AuditEventType.STATE_ACTIVATED,
        to_state=state.id,
    )


def _record_state_done(
    workflow: Workflow, state: State, step: StepResult, result: AdvanceResult
) -> None:
    details: dict[str, Any] = {}
    if step.confidence is not None:
        details["confidence"] = step.confidence
    kind = {
        StateType.EXECUTION: AuditEventType.EXECUTION,
    }.get(state.type)
    if kind is not None:
        # Surface the execution receipt so the audit trail is self-contained.
        package = step.data.get("package") if isinstance(step.data, dict) else None
        if isinstance(package, dict):
            for key in ("confirmation_id", "submitted_at", "simulated"):
                if key in package:
                    details[key] = package[key]
        _emit(workflow, result, kind, from_state=state.id, details=details)


def _emit(
    workflow: Workflow,
    result: AdvanceResult,
    event_type: AuditEventType,
    *,
    from_state: Optional[str] = None,
    to_state: Optional[str] = None,
    confidence: Optional[float] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    result.events.append(
        AuditEvent(
            workflow_id=workflow.workflow_id,
            event_type=event_type,
            from_state=from_state,
            to_state=to_state,
            confidence=confidence,
            details=details or {},
        )
    )


def _set(workflow: Workflow, state: State, status: StateStatus) -> None:
    state.status = status
    workflow.touch()


def needs_label(state: State) -> str:
    """Normalized label describing what a gated state is waiting for.

    This is the single source of truth for the `needs` value returned to clients,
    shared by `advance_workflow` and `WorkflowService.to_detail` so a GET and a
    POST always report the same gate.
    """
    return {
        StateType.USER_INPUT: "user_input",
        StateType.DOCUMENT_REQUIRED: "document_upload",
        StateType.HUMAN_APPROVAL: "approval",
    }.get(state.type, "action")


def _is_waiting(status: str) -> bool:
    return status in ("needs_document", "needs_input", "needs_approval")
