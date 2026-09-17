"""In-memory repository used for DEMO_MODE/local development and tests.

Thread-safe and value-isolated: reads return deep copies and writes store deep
copies. This matches the serialization boundary of a real database
(DynamoRepository), so callers can never mutate persisted state by reference and
concurrent requests cannot corrupt shared dicts.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import DefaultDict

from ..models.audit import AuditEvent
from ..models.document import DocumentRecord
from ..models.workflow import Workflow
from .repository import WorkflowRepository


class InMemoryRepository(WorkflowRepository):
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._workflows: dict[str, Workflow] = {}
        self._documents: DefaultDict[str, dict[str, DocumentRecord]] = defaultdict(dict)
        self._audit: DefaultDict[str, list[AuditEvent]] = defaultdict(list)

    def save_workflow(self, workflow: Workflow) -> None:
        with self._lock:
            self._workflows[workflow.workflow_id] = workflow.model_copy(deep=True)

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        with self._lock:
            stored = self._workflows.get(workflow_id)
            return stored.model_copy(deep=True) if stored is not None else None

    def save_document(self, doc: DocumentRecord) -> None:
        with self._lock:
            self._documents[doc.workflow_id][doc.document_id] = doc.model_copy(deep=True)

    def get_document(self, workflow_id: str, document_id: str) -> DocumentRecord | None:
        with self._lock:
            stored = self._documents[workflow_id].get(document_id)
            return stored.model_copy(deep=True) if stored is not None else None

    def list_documents(self, workflow_id: str) -> list[DocumentRecord]:
        with self._lock:
            return [d.model_copy(deep=True) for d in self._documents[workflow_id].values()]

    def append_audit(self, event: AuditEvent) -> None:
        with self._lock:
            self._audit[event.workflow_id].append(event.model_copy(deep=True))

    def list_audit(self, workflow_id: str) -> list[AuditEvent]:
        with self._lock:
            return [e.model_copy(deep=True) for e in self._audit[workflow_id]]
