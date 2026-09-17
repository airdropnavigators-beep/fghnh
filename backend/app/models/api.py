"""API request/response models (contract-first; frontend can build against mocks)."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from .enums import WorkflowStatus


class CreateWorkflowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: str = Field(
        min_length=3,
        max_length=500,
        description="Natural-language goal the workflow should accomplish.",
    )


class CreateWorkflowResponse(BaseModel):
    workflow_id: str = Field(description="Server-assigned workflow identifier.")
    status: WorkflowStatus
    workflow: dict[str, Any] = Field(
        description="The validated workflow definition (see docs/workflow-engine.md)."
    )


class AdvanceWorkflowRequest(BaseModel):
    """Payload accepted by POST /workflows/{id}/advance.

    Only the field relevant to the current gated state is consumed; other fields are
    ignored by the deterministic executor.
    """

    model_config = ConfigDict(extra="forbid")

    user_input: dict[str, Any] = Field(
        default_factory=dict,
        description="Values for the current user_input state, keyed by required_data field.",
    )
    approval: Optional[bool] = Field(
        default=None,
        description="Explicit approve/deny decision for the current human_approval state.",
    )
    acknowledge: Optional[bool] = Field(
        default=None,
        description="Acknowledge a warning gate (e.g. a low-confidence validation issue).",
    )
    confirm: Optional[bool] = Field(
        default=None,
        description="Generic confirmation for user_confirmed transitions.",
    )
    document_id: Optional[str] = Field(
        default=None,
        description="Optional reference to a specific uploaded document.",
    )


class WorkflowProgress(BaseModel):
    completed: int = Field(description="Number of states completed.")
    total: int = Field(description="Total number of states in the workflow.")
    ratio: float = Field(ge=0.0, le=1.0, description="completed / total.")


class WorkflowDetailResponse(BaseModel):
    workflow_id: str
    status: WorkflowStatus
    goal: str
    current_state: Optional[str] = Field(default=None, description="id of the active state.")
    last_message: Optional[str] = Field(
        default=None, description="Human-readable assistant message for the current state."
    )
    needs: Optional[str] = Field(
        default=None,
        description="Normalized gate label: user_input | document_upload | approval | action.",
    )
    progress: WorkflowProgress
    states: list[dict[str, Any]] = Field(description="Serialized state nodes for the graph view.")
    collected_documents: list[str] = Field(
        default_factory=list, description="Classifications of documents received so far."
    )
    validation: Optional[dict[str, Any]] = Field(
        default=None, description="Latest cross-document validation result, if any."
    )


class AdvanceWorkflowResponse(WorkflowDetailResponse):
    """Result of one advance step: the updated detail plus what the executor did."""

    message: Optional[str] = Field(default=None, description="Status message for this step.")
    completed: bool = Field(default=False, description="True once a terminal state is reached.")
    events: list[dict[str, Any]] = Field(
        default_factory=list, description="Audit events emitted by this step."
    )


class AuditListResponse(BaseModel):
    workflow_id: str
    events: list[dict[str, Any]] = Field(default_factory=list)


class DocumentUploadResponse(BaseModel):
    document_id: str
    filename: str
    classification: Optional[str] = Field(default=None, description="Detected document category.")
    confidence: Optional[float] = Field(
        default=None, description="Classification confidence in [0, 1]."
    )
    extracted_fields: dict[str, Any] = Field(
        default_factory=dict, description="Extracted fields, each with value/confidence/source_text."
    )
    validation_status: Optional[str] = Field(
        default=None, description="Per-document status: pass | needs_review | block."
    )
    issues: list[dict[str, Any]] = Field(default_factory=list)
    message: str = ""
