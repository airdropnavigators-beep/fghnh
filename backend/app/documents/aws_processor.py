"""AWS implementations of the document interfaces.

- S3ObjectStore: private, encrypted S3 bucket, generated keys, MIME/size validated
  by the API layer before reaching here.
- TextractProcessor: extracts text using Amazon Textract.

Textract has two entry points with different limits:
  * `DetectDocumentText(Bytes=...)` — synchronous, PNG/JPEG only, <= 5 MB.
  * `StartDocumentTextDetection(S3Object=...)` — asynchronous, also accepts PDF/TIFF
    and multi-page documents; results are paged and must be polled.
The processor picks the right one from the MIME type and size, so a PDF upload no
longer fails with an InvalidParameter/UnsupportedDocument error.

These are only exercised when DEMO_MODE=false.
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from .processor import DocumentObjectStore, DocumentProcessor

_SYNC_MIME_TYPES = {"image/png", "image/jpeg"}
_S3_PREFIX = "s3://"


class S3ObjectStore(DocumentObjectStore):
    def __init__(self, bucket: str, region: str = "us-east-1", client: Any = None) -> None:
        if client is not None:
            self._s3 = client
        else:
            import boto3

            self._s3 = boto3.client("s3", region_name=region)
        self._bucket = bucket

    def put(self, key: str, content: bytes, mime_type: str) -> str:
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=content,
            ContentType=mime_type,
            ServerSideEncryption="AES256",
        )
        return f"{_S3_PREFIX}{self._bucket}/{key}"

    def delete(self, key: str) -> None:
        try:
            self._s3.delete_object(Bucket=self._bucket, Key=key)
        except Exception:  # noqa: BLE001 - best effort cleanup in demo context
            pass


def generate_object_key(workflow_id: str, filename: str) -> str:
    safe = "".join(c for c in filename if c.isalnum() or c in "._- ").replace(" ", "_")
    return f"uploads/{workflow_id}/{uuid.uuid4().hex[:12]}_{safe}"


def parse_s3_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith(_S3_PREFIX) or "/" not in uri[len(_S3_PREFIX):]:
        raise ValueError(f"not an s3 uri: {uri!r}")
    bucket, key = uri[len(_S3_PREFIX):].split("/", 1)
    return bucket, key


class TextractProcessor(DocumentProcessor):
    def __init__(
        self,
        region: str = "us-east-1",
        client: Any = None,
        *,
        bucket: str | None = None,
        max_sync_bytes: int = 5 * 1024 * 1024,
        async_poll_seconds: float = 1.5,
        async_timeout_seconds: float = 60.0,
        sleep: Any = time.sleep,
    ) -> None:
        if client is not None:
            self._textract = client
        else:
            import boto3

            self._textract = boto3.client("textract", region_name=region)
        self._bucket = bucket
        self._max_sync_bytes = max_sync_bytes
        self._poll = async_poll_seconds
        self._timeout = async_timeout_seconds
        self._sleep = sleep

    def extract_text(
        self,
        content: bytes,
        filename: str,
        mime_type: str,
        storage_uri: str | None = None,
    ) -> str:
        if mime_type in _SYNC_MIME_TYPES and len(content) <= self._max_sync_bytes:
            resp = self._textract.detect_document_text(Document={"Bytes": content})
            return _lines(resp.get("Blocks", []))

        if not storage_uri:
            raise ValueError(
                f"{mime_type} documents larger than the synchronous limit need an S3 location; "
                "none was provided"
            )
        bucket, key = parse_s3_uri(storage_uri)
        return self._extract_async(bucket, key)

    def _extract_async(self, bucket: str, key: str) -> str:
        start = self._textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
        )
        job_id = start["JobId"]
        deadline = time.monotonic() + self._timeout
        blocks: list[dict[str, Any]] = []
        next_token: str | None = None

        while True:
            kwargs: dict[str, Any] = {"JobId": job_id}
            if next_token:
                kwargs["NextToken"] = next_token
            resp = self._textract.get_document_text_detection(**kwargs)
            status = resp.get("JobStatus")
            if status == "IN_PROGRESS":
                if time.monotonic() > deadline:
                    raise TimeoutError(f"Textract job {job_id} did not finish within {self._timeout:.0f}s")
                self._sleep(self._poll)
                continue
            if status not in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
                raise RuntimeError(f"Textract job {job_id} ended with status {status}: {resp.get('StatusMessage', '')}")
            blocks.extend(resp.get("Blocks", []))
            next_token = resp.get("NextToken")
            if not next_token:
                return _lines(blocks)


def _lines(blocks: list[dict[str, Any]]) -> str:
    return "\n".join(
        block["Text"] for block in blocks if block.get("BlockType") == "LINE" and block.get("Text")
    )
