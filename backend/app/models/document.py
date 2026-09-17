"""Pydantic models for documents, extraction and validation."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from .enums import DocumentStatus, ValidationSeverity, ValidationStatus


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ExtractedField(BaseModel):
    """A single extracted field. `source_text` must reference actual document
    content so the model cannot invent values."""

    model_config = ConfigDict(extra="forbid")

    value: Any
    confidence: float = Field(ge=0.0, le=1.0)
    source_text: Optional[str] = None


class ClassificationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    classification: str
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""


class DocumentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: str
    document_id: str
    filename: str
    mime_type: str
    s3_key: Optional[str] = None
    classification: Optional[str] = None
    classification_confidence: Optional[float] = None
    extracted_fields: dict[str, ExtractedField] = Field(default_factory=dict)
    status: DocumentStatus = DocumentStatus.UPLOADED
    validation_status: Optional[ValidationStatus] = None
    validation_issues: list["ValidationIssue"] = Field(default_factory=list)
    uploaded_at: str = Field(default_factory=utc_now_iso)
    processed_at: Optional[str] = None


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: ValidationSeverity
    field: str
    message: str
    evidence: list[str] = Field(default_factory=list)
    suggestion: Optional[str] = None


class CrossValidationResult(BaseModel):
    """Output of the cross-document validator."""

    status: ValidationStatus
    confidence: float = Field(ge=0.0, le=1.0)
    issues: list[ValidationIssue] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    checked_documents: list[str] = Field(default_factory=list)


DocumentRecord.model_rebuild()
