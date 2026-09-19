"""Document ingest + processing interfaces.

`DocumentObjectStore` handles byte storage (S3 in prod, in-memory in demo).
`DocumentProcessor` handles AI extraction (Textract in prod, deterministic in demo).
Business logic in services depends only on these interfaces.
"""

from __future__ import annotations

from typing import Protocol


class DocumentObjectStore(Protocol):
    def put(self, key: str, content: bytes, mime_type: str) -> str:
        """Store bytes at key; returns a storage URI."""
        ...

    def delete(self, key: str) -> None:
        ...


class DocumentProcessor(Protocol):
    def extract_text(
        self,
        content: bytes,
        filename: str,
        mime_type: str,
        storage_uri: str | None = None,
    ) -> str:
        """Return plain text for downstream classification/extraction.

        `storage_uri` is the URI returned by the object store for this upload; processors
        that must read from durable storage (asynchronous Textract jobs) use it instead
        of the in-memory bytes.
        """
        ...
