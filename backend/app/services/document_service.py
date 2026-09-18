"""Document pipeline orchestration.

upload -> store -> extract text -> classify -> extract fields -> persist.
Cross-document validation runs later at the `validation` state (workflow_service).
"""

from __future__ import annotations

import uuid

from ..ai.llm_provider import LLMProvider
from ..core.observability import log_event
from ..documents.processor import DocumentObjectStore, DocumentProcessor
from ..models.document import DocumentRecord
from ..models.enums import DocumentStatus
from ..storage.repository import WorkflowRepository


class DocumentService:
    def __init__(
        self,
        repo: WorkflowRepository,
        store: DocumentObjectStore,
        processor: DocumentProcessor,
        llm: LLMProvider,
        object_key_fn,
    ) -> None:
        self._repo = repo
        self._store = store
        self._processor = processor
        self._llm = llm
        self._object_key_fn = object_key_fn

    def process_upload(
        self,
        workflow_id: str,
        filename: str,
        mime_type: str,
        content: bytes,
    ) -> DocumentRecord:
        document_id = f"doc_{uuid.uuid4().hex[:12]}"
        doc = DocumentRecord(
            workflow_id=workflow_id,
            document_id=document_id,
            filename=filename,
            mime_type=mime_type,
            status=DocumentStatus.PROCESSING,
        )
        self._repo.save_document(doc)

        try:
            key = self._object_key_fn(workflow_id, filename)
            doc.s3_key = self._store.put(key, content, mime_type)

            text = self._processor.extract_text(content, filename, mime_type)
            classification = self._llm.classify_document(text)
            doc.classification = classification.classification
            doc.classification_confidence = classification.confidence
            doc.status = DocumentStatus.CLASSIFIED
            self._repo.save_document(doc)

            fields = self._llm.extract_fields(text, classification.classification)
            doc.extracted_fields = fields
            doc.status = DocumentStatus.EXTRACTED
            doc.processed_at = _now()
            self._repo.save_document(doc)

            log_event(
                "document_processed",
                workflow_id=workflow_id,
                document_id=document_id,
                classification=doc.classification,
                status=doc.status.value,
            )

            return doc
        except Exception as exc:  # noqa: BLE001 - normalized to a stable error
            doc.status = DocumentStatus.FAILED
            self._repo.save_document(doc)

            log_event(
                "error",
                component="document_service",
                workflow_id=workflow_id,
                document_id=document_id,
                error_type=type(exc).__name__,
                message=str(exc),
            )

            raise DocumentProcessingException(str(exc)) from exc


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


class DocumentProcessingException(Exception):
    pass
