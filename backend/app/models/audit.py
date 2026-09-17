"""Audit log event model."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from .enums import AuditEventType


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuditEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    timestamp: str = Field(default_factory=utc_now_iso)
    workflow_id: str
    event_type: AuditEventType
    from_state: Optional[str] = None
    to_state: Optional[str] = None
    confidence: Optional[float] = None
    details: dict[str, Any] = Field(default_factory=dict)
