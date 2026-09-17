"""Workflow orchestration service.

Composes the deterministic state machine with application handlers and the AI
components. This is where LLM outputs are consumed as DATA for deterministic
handlers — execution itself never asks the LLM anything.
"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from itertools import count
from typing import Any, Optional

from ..ai.llm_provider import LLMProvider
from ..ai.workflow_generator import WorkflowGenerator
from ..core.config import Settings
from ..models.api import AdvanceWorkflowRequest, WorkflowDetailResponse, WorkflowProgress
from ..models.audit import AuditEvent
from ..models.document import DocumentRecord, ExtractedField
from ..models.enums import (
    AuditEventType,
    StateStatus,
    StateType,
    ValidationStatus,
    WorkflowStatus,
)
from ..models.workflow import State, Workflow
from ..services.demo_scenario import DEMO_PROFILE
from ..services.eligibility import check_eligibility
from ..storage.repository import WorkflowRepository
from ..workflow.errors import WorkflowNotFound
from ..workflow.state_machine import (
    AdvanceResult,
    ExecutionContext,
    StepHandlerMap,
    StepResult,
    advance_workflow,
    needs_label,
)

logger = logging.getLogger(__name__)


class WorkflowService:
    def __init__(
        self,
        repo: WorkflowRepository,
        generator: WorkflowGenerator,
        llm: LLMProvider,
        settings: Settings,
        knowledge: dict,
    ) -> None:
        self._repo = repo
        self._generator = generator
        self._llm = llm
        self._settings = settings
        self._knowledge = knowledge
        self._requirements = knowledge["process"]["requirements"]

    # ------------------------------------------------------------------ create

    def create_workflow(self, goal: str) -> Workflow:
        workflow_id = f"wf_{uuid.uuid4().hex[:12]}"
        self._repo.append_audit(
            AuditEvent(workflow_id=workflow_id, event_type=AuditEventType.WORKFLOW_CREATED, details={"goal": goal})
        )
        generated = self._generator.generate(goal, self._knowledge)
        workflow = generated.model_copy(deep=True)
        workflow.workflow_id = workflow_id
        workflow.goal = goal
        workflow.status = WorkflowStatus.IN_PROGRESS
        for state in workflow.states:
            state.status = StateStatus.PENDING
        self._repo.append_audit(
            AuditEvent(
                workflow_id=workflow_id,
                event_type=AuditEventType.WORKFLOW_GENERATED,
                details={"states": len(workflow.states)},
            )
        )
        self._repo.save_workflow(workflow)
        return workflow

    # ------------------------------------------------------------------ read

    def get_workflow(self, workflow_id: str) -> Optional[Workflow]:
        return self._repo.get_workflow(workflow_id)

    def audit_event(
        self,
        workflow_id: str,
        event_type: AuditEventType,
        *,
        details: Optional[dict[str, Any]] = None,
        confidence: Optional[float] = None,
    ) -> AuditEvent:
        return AuditEvent(
            workflow_id=workflow_id,
            event_type=event_type,
            details=details or {},
            confidence=confidence,
        )

    def to_detail(self, workflow: Workflow) -> WorkflowDetailResponse:
        active = next((s for s in workflow.states if s.status == StateStatus.ACTIVE), None)
        completed = sum(1 for s in workflow.states if s.status in {StateStatus.COMPLETED})
        total = max(1, len(workflow.states))
        has_warning = any(s.status == StateStatus.WARNING for s in workflow.states)
        docs = {
            d.classification: d
            for d in self._repo.list_documents(workflow.workflow_id)
            if d.classification
        }

        validation = workflow.collected_data.get("validation_result")

        return WorkflowDetailResponse(
            workflow_id=workflow.workflow_id,
            status=workflow.status,
            goal=workflow.goal,
            current_state=active.id if active else workflow.current_state,
            last_message=_message(active, workflow, docs, has_warning),
            needs=needs_label(active) if active else None,
            progress=WorkflowProgress(completed=completed, total=total, ratio=completed / total),
            states=[s.model_dump() for s in workflow.states],
            collected_documents=sorted(docs),
            validation=validation,
        )

    # ----------------------------------------------------------------- advance

    def advance(self, workflow_id: str, inputs: Optional[AdvanceWorkflowRequest] = None) -> AdvanceResult:
        workflow = self._repo.get_workflow(workflow_id)
        if workflow is None:
            raise WorkflowNotFound(f"workflow '{workflow_id}' not found")
        ctx = self._build_context(workflow)
        handlers = self._build_handlers(workflow)
        result = advance_workflow(workflow, handlers, ctx, inputs)
        validation_result = ctx.results.get(_validation_state_id(workflow))
        if validation_result:
            workflow.collected_data["validation_result"] = validation_result
        for event in result.events:
            self._repo.append_audit(event)
        self._repo.save_workflow(workflow)
        return result

    # ------------------------------------------------------------- internals

    def _build_context(self, workflow: Workflow) -> ExecutionContext:
        docs = self._repo.list_documents(workflow.workflow_id)
        collected = {d.classification: d for d in docs if d.classification}
        data: dict[str, Any] = dict(workflow.collected_data)
        data["profile"] = data.get("profile") or DEMO_PROFILE
        return ExecutionContext(data=data, collected_documents=collected, results={})

    def _build_handlers(self, workflow: Workflow) -> StepHandlerMap:
        handlers: StepHandlerMap = {}
        for state in workflow.states:
            if state.type == StateType.AUTOMATIC:
                handlers[state.id] = _eligibility_handler(self._requirements)
            elif state.type == StateType.VALIDATION:
                handlers[state.id] = _validation_handler(self._llm, self._requirements, self._settings)
            elif state.type == StateType.EXECUTION:
                handlers[state.id] = _submission_handler()
        return handlers


# ------------------------------------------------------------------ handlers


def _eligibility_handler(requirements: dict) -> Any:
    def execute(state: State, ctx: ExecutionContext) -> StepResult:
        profile = ctx.data.get("profile", {})
        eligible, reasons = check_eligibility(profile, requirements)
        return StepResult(
            status="completed",
            confidence=0.99,
            data={"eligible": eligible, "reasons": reasons},
        )

    return execute


def _validation_handler(llm: LLMProvider, requirements: dict, settings: Settings) -> Any:
    def execute(state: State, ctx: ExecutionContext) -> StepResult:
        extracted: dict[str, dict[str, ExtractedField]] = {}
        for classification, doc in ctx.collected_documents.items():
            if isinstance(doc, DocumentRecord) and getattr(doc, "extracted_fields", None):
                extracted[classification] = dict(doc.extracted_fields)
        result = llm.run_cross_validation(requirements, extracted)
        status = result.status

        # confidence gate applied on top of the validator's structural status
        if result.confidence < settings.confidence_warn:
            status = ValidationStatus.BLOCK
        elif result.confidence < settings.confidence_pass and status == ValidationStatus.PASS:
            status = ValidationStatus.NEEDS_REVIEW

        payload = {
            "status": status.value,
            "confidence": result.confidence,
            "issues": [i.model_dump() for i in result.issues],
            "suggestions": result.suggestions,
            "checked_documents": result.checked_documents,
        }
        return StepResult(status="completed", confidence=result.confidence, data=payload)

    return execute


def _submission_handler() -> Any:
    def execute(state: State, ctx: ExecutionContext) -> StepResult:
        confirmation_id = _next_confirmation_id()
        package = {
            "confirmation_id": confirmation_id,
            "documents": sorted(ctx.collected_documents),
            "eligible": ctx.data.get("profile", {}).get("cumulative_gpa") is not None,
            "submitted_at": _now(),
            "simulated": True,
        }
        return StepResult(
            status="completed",
            confidence=1.0,
            data={"submitted": True, "package": package},
        )

    return execute


_confirmation_counter = count(2026001)
_confirmation_lock = threading.Lock()


def _next_confirmation_id() -> str:
    """Monotonic, thread-safe confirmation id (e.g. ``FF-2026002``)."""
    with _confirmation_lock:
        return f"FF-{next(_confirmation_counter)}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validation_state_id(workflow: Workflow) -> Optional[str]:
    for s in workflow.states:
        if s.type == StateType.VALIDATION:
            return s.id
    return None


def _message(
    active: Optional[State],
    workflow: Workflow,
    docs: dict[str, DocumentRecord],
    has_warning: bool,
) -> Optional[str]:
    if workflow.status == WorkflowStatus.COMPLETED:
        return "Workflow completed. Application submitted successfully."
    if workflow.status == WorkflowStatus.CANCELLED:
        return "Submission declined. Workflow ended."
    if active is None:
        return "Ready to begin."
    if active.type == StateType.DOCUMENT_REQUIRED:
        missing = [d for d in active.required_documents if d not in docs]
        if missing:
            return f"Upload required documents: {', '.join(missing)}."
        return "All required documents received."
    if active.type == StateType.HUMAN_APPROVAL:
        return "This action requires your explicit approval."
    if active.type == StateType.USER_INPUT:
        return active.description
    return active.description
