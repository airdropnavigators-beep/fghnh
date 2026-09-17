"""Workflow + document + audit API routes (thin HTTP layer)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..models.api import (
    AdvanceWorkflowRequest,
    AdvanceWorkflowResponse,
    AuditListResponse,
    CreateWorkflowRequest,
    CreateWorkflowResponse,
    DocumentUploadResponse,
    WorkflowDetailResponse,
)
from ..models.enums import AuditEventType
from ..workflow.errors import (
    ExecutionError,
    InvalidTransitionError,
    WorkflowAlreadyTerminalError,
    WorkflowGenerationError,
    WorkflowNotFound,
    WorkflowValidationError,
)
from .deps import Services, get_services

logger = logging.getLogger(__name__)
router = APIRouter()

_UPLOAD_CHUNK_BYTES = 1024 * 1024


def _http(e: Exception) -> HTTPException:
    """Map a domain error to an HTTP response.

    Unknown errors become a generic 500: internal messages are logged, never
    returned to the client, to avoid leaking implementation details.
    """
    if isinstance(e, WorkflowNotFound):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, WorkflowGenerationError):
        return HTTPException(status_code=409, detail=str(e) or "workflow_generation_failed")
    if isinstance(e, (WorkflowValidationError, InvalidTransitionError, ExecutionError)):
        return HTTPException(status_code=422, detail=str(e))
    if isinstance(e, WorkflowAlreadyTerminalError):
        return HTTPException(status_code=409, detail=str(e))
    logger.error("unhandled API error: %s", e, exc_info=e)
    return HTTPException(status_code=500, detail="Internal server error")


@router.post("/workflows", response_model=CreateWorkflowResponse)
def create_workflow(
    req: CreateWorkflowRequest, services: Services = Depends(get_services)
) -> CreateWorkflowResponse:
    try:
        workflow = services.workflow_service.create_workflow(req.goal)
    except (WorkflowGenerationError, WorkflowValidationError) as exc:
        raise _http(exc) from exc
    return CreateWorkflowResponse(
        workflow_id=workflow.workflow_id,
        status=workflow.status,
        workflow=workflow.model_dump(),
    )


@router.get("/workflows/{workflow_id}", response_model=WorkflowDetailResponse)
def get_workflow(
    workflow_id: str, services: Services = Depends(get_services)
) -> WorkflowDetailResponse:
    workflow = services.workflow_service.get_workflow(workflow_id)
    if workflow is None:
        raise _http(WorkflowNotFound(f"workflow '{workflow_id}' not found"))
    return services.workflow_service.to_detail(workflow)


@router.post("/workflows/{workflow_id}/advance", response_model=AdvanceWorkflowResponse)
def advance(
    workflow_id: str,
    req: AdvanceWorkflowRequest,
    services: Services = Depends(get_services),
) -> AdvanceWorkflowResponse:
    try:
        result = services.workflow_service.advance(workflow_id, req)
    except (
        WorkflowNotFound,
        ExecutionError,
        InvalidTransitionError,
        WorkflowAlreadyTerminalError,
    ) as exc:
        raise _http(exc) from exc
    payload = services.workflow_service.to_detail(result.workflow).model_dump()
    payload.update(
        needs=result.needs,
        message=result.message,
        completed=result.completed,
        events=[e.model_dump() for e in result.events],
    )
    return AdvanceWorkflowResponse(**payload)


@router.post("/workflows/{workflow_id}/documents", response_model=DocumentUploadResponse)
async def upload_document(
    workflow_id: str,
    file: UploadFile = File(...),
    services: Services = Depends(get_services),
) -> DocumentUploadResponse:
    settings = services.settings
    limit = settings.max_document_size_mb * 1024 * 1024
    content = await _read_within_limit(file, limit)
    mime = file.content_type or "application/octet-stream"
    if mime not in settings.allowed_mime_types and not settings.demo_mode:
        raise HTTPException(status_code=415, detail="unsupported file type")

    workflow = services.workflow_service.get_workflow(workflow_id)
    if workflow is None:
        raise _http(WorkflowNotFound(f"workflow '{workflow_id}' not found"))

    services.repo.append_audit(
        services.workflow_service.audit_event(
            workflow_id, AuditEventType.DOCUMENT_UPLOADED, details={"filename": file.filename}
        )
    )
    try:
        record = services.document_service.process_upload(
            workflow_id, file.filename or "document", mime, content
        )
    except Exception as exc:  # noqa: BLE001 - normalized for the client
        logger.warning("document processing failed for workflow %s: %s", workflow_id, exc)
        raise HTTPException(
            status_code=422,
            detail="We couldn't reliably process this document. Please upload a clearer version.",
        ) from exc
    services.repo.append_audit(
        services.workflow_service.audit_event(
            workflow_id,
            AuditEventType.FIELD_EXTRACTED,
            details={"documentId": record.document_id, "classification": record.classification},
        )
    )
    return DocumentUploadResponse(
        document_id=record.document_id,
        filename=record.filename,
        classification=record.classification,
        confidence=record.classification_confidence,
        extracted_fields=_fields_payload(record),
        validation_status=record.validation_status.value if record.validation_status else None,
        issues=[i.model_dump() for i in record.validation_issues],
        message="Document processed",
    )


@router.get("/workflows/{workflow_id}/audit", response_model=AuditListResponse)
def list_audit(workflow_id: str, services: Services = Depends(get_services)) -> AuditListResponse:
    if services.workflow_service.get_workflow(workflow_id) is None:
        raise _http(WorkflowNotFound(f"workflow '{workflow_id}' not found"))
    events = services.repo.list_audit(workflow_id)
    return AuditListResponse(
        workflow_id=workflow_id, events=[e.model_dump() for e in events]
    )


async def _read_within_limit(file: UploadFile, limit: int) -> bytes:
    """Read an upload in bounded chunks, rejecting oversized files without
    buffering the entire body in memory first."""
    buffer = bytearray()
    while chunk := await file.read(_UPLOAD_CHUNK_BYTES):
        buffer.extend(chunk)
        if len(buffer) > limit:
            raise HTTPException(status_code=413, detail="file exceeds size limit")
    return bytes(buffer)


def _fields_payload(record) -> dict[str, Any]:
    return {
        k: {"value": v.value, "confidence": v.confidence, "source_text": v.source_text}
        for k, v in record.extracted_fields.items()
    }
