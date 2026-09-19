"""AWS adapter tests with fake clients (audit findings B-3, B-4, B-9, B-10, B-14).

No network: a dict-backed DynamoDB fake and a scripted Textract fake exercise the
serialisation, keying, pagination and sync/async routing logic.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

from app.api import deps
from app.core.config import Settings
from app.documents.aws_processor import TextractProcessor, parse_s3_uri
from app.models.audit import AuditEvent
from app.models.document import DocumentRecord, ExtractedField
from app.models.enums import AuditEventType
from app.storage.dynamo import DynamoRepository, _dumps, _loads

# ---------------------------------------------------------------- fakes


class FakeDynamo:
    """Minimal DynamoDB client: put/get/query with paging + condition expressions."""

    def __init__(self, page_size: int = 2) -> None:
        self.tables: dict[str, dict[tuple, dict]] = {}
        self.page_size = page_size
        self.queries = 0

    @staticmethod
    def _key(item: dict) -> tuple:
        pk = item["workflowId"]["S"]
        sk = item.get("documentId", item.get("timestamp"))
        return (pk, sk["S"] if sk else None)

    def put_item(self, TableName: str, Item: dict, ConditionExpression: str | None = None, **_: Any) -> None:
        table = self.tables.setdefault(TableName, {})
        key = self._key(Item)
        if ConditionExpression and "attribute_not_exists" in ConditionExpression and key in table:
            raise RuntimeError("ConditionalCheckFailedException")
        table[key] = Item

    def get_item(self, TableName: str, Key: dict) -> dict:
        table = self.tables.get(TableName, {})
        pk = Key["workflowId"]["S"]
        sk = Key.get("documentId", {}).get("S")
        item = table.get((pk, sk))
        return {"Item": item} if item else {}

    def query(
        self, TableName: str, ExpressionAttributeValues: dict, ExclusiveStartKey: dict | None = None, **_: Any
    ) -> dict:
        self.queries += 1
        pk = ExpressionAttributeValues[":wid"]["S"]
        rows = sorted(
            (item for (p, _), item in self.tables.get(TableName, {}).items() if p == pk),
            key=lambda i: (i.get("timestamp") or i.get("documentId"))["S"],
        )
        start = ExclusiveStartKey["offset"] if ExclusiveStartKey else 0
        page = rows[start : start + self.page_size]
        resp: dict[str, Any] = {"Items": page}
        if start + self.page_size < len(rows):
            resp["LastEvaluatedKey"] = {"offset": start + self.page_size}
        return resp


class FakeTextract:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.polls_before_done = 2

    def detect_document_text(self, Document: dict) -> dict:
        self.calls.append("sync")
        assert "Bytes" in Document
        return {"Blocks": [{"BlockType": "LINE", "Text": "Sync line"}, {"BlockType": "WORD", "Text": "x"}]}

    def start_document_text_detection(self, DocumentLocation: dict) -> dict:
        self.calls.append("start")
        self.location = DocumentLocation["S3Object"]
        return {"JobId": "job-1"}

    def get_document_text_detection(self, JobId: str, NextToken: str | None = None) -> dict:
        self.calls.append(f"get:{NextToken}")
        if self.polls_before_done > 0:
            self.polls_before_done -= 1
            return {"JobStatus": "IN_PROGRESS"}
        if NextToken is None:
            return {"JobStatus": "SUCCEEDED", "Blocks": [{"BlockType": "LINE", "Text": "Page 1"}], "NextToken": "p2"}
        return {"JobStatus": "SUCCEEDED", "Blocks": [{"BlockType": "LINE", "Text": "Page 2"}]}


@pytest.fixture
def repo() -> tuple[DynamoRepository, FakeDynamo]:
    fake = FakeDynamo(page_size=2)
    return DynamoRepository("wf", "docs", "audit", client=fake), fake


# --------------------------------------------------------------- B-9 numbers


def test_numbers_round_trip_as_numbers():
    rec = DocumentRecord(
        workflow_id="w",
        document_id="d",
        filename="f.pdf",
        mime_type="application/pdf",
        classification_confidence=0.75,
        extracted_fields={"gpa": ExtractedField(value="3.2", confidence=0.9, source_text="GPA 3.2")},
    )
    item = _dumps(rec.model_dump())
    assert item["classification_confidence"] == {"N": "0.75"}
    back = _loads(item)
    assert back["classification_confidence"] == 0.75
    assert isinstance(back["extracted_fields"]["gpa"]["confidence"], float)


def test_event_details_numbers_survive():
    ev = AuditEvent(workflow_id="w", event_type=AuditEventType.EXECUTION, details={"confidence": 1.0, "n": 3})
    back = _loads(_dumps(ev.model_dump()))
    assert back["details"] == {"confidence": 1.0, "n": 3}
    assert back["confidence"] is None


# --------------------------------------------------------- B-3 audit keying


def test_same_timestamp_events_are_both_kept(repo):
    r, fake = repo
    ts = "2026-01-01T00:00:00.000000+00:00"
    r.append_audit(AuditEvent(workflow_id="w", event_type=AuditEventType.STATE_TRANSITION, timestamp=ts))
    r.append_audit(AuditEvent(workflow_id="w", event_type=AuditEventType.STATE_ACTIVATED, timestamp=ts))
    events = r.list_audit("w")
    # Both survive (previously the second put_item overwrote the first).
    assert {e.event_type for e in events} == {AuditEventType.STATE_TRANSITION, AuditEventType.STATE_ACTIVATED}
    assert all(e.timestamp == ts for e in events)  # sort-key suffix is stripped on read
    assert len({e.event_id for e in events}) == 2


def test_duplicate_audit_row_is_refused(repo):
    r, fake = repo
    ev = AuditEvent(workflow_id="w", event_type=AuditEventType.EXECUTION)
    r.append_audit(ev)
    with pytest.raises(RuntimeError):
        r.append_audit(ev)


def test_legacy_bare_timestamp_rows_still_read(repo):
    r, fake = repo
    legacy = _dumps({
        "workflowId": "w",
        "workflow_id": "w",
        "timestamp": "2026-01-01T00:00:00+00:00",
        "event_id": "abc",
        "event_type": "workflow_created",
        "from_state": "None",
        "to_state": "None",
        "confidence": "None",
        "details": {},
    })
    fake.put_item("audit", legacy)
    [ev] = r.list_audit("w")
    assert ev.timestamp == "2026-01-01T00:00:00+00:00"
    assert ev.confidence is None and ev.from_state is None


# ------------------------------------------------------------ B-10 pagination


def test_list_audit_follows_pagination(repo):
    r, fake = repo
    for i in range(5):
        ts = f"2026-01-01T00:00:0{i}+00:00"
        r.append_audit(AuditEvent(workflow_id="w", event_type=AuditEventType.STATE_ACTIVATED, timestamp=ts))
    events = r.list_audit("w")
    assert len(events) == 5
    assert fake.queries == 3  # 2 + 2 + 1


def test_list_documents_follows_pagination(repo):
    r, fake = repo
    for i in range(3):
        r.save_document(DocumentRecord(workflow_id="w", document_id=f"d{i}", filename="f", mime_type="image/png"))
    assert len(r.list_documents("w")) == 3


# ------------------------------------------------------- B-4 Textract routing


def test_small_png_uses_sync_bytes_api():
    fake = FakeTextract()
    p = TextractProcessor(client=fake, bucket="b")
    text = p.extract_text(b"png", "id.png", "image/png", storage_uri="s3://b/uploads/x.png")
    assert text == "Sync line"
    assert fake.calls == ["sync"]


def test_pdf_uses_async_s3_job_and_pages_results():
    fake = FakeTextract()
    p = TextractProcessor(client=fake, bucket="b", async_poll_seconds=0, sleep=lambda _s: None)
    text = p.extract_text(b"%PDF", "transcript.pdf", "application/pdf", storage_uri="s3://b/uploads/w/t.pdf")
    assert text == "Page 1\nPage 2"
    assert fake.location == {"Bucket": "b", "Name": "uploads/w/t.pdf"}
    assert fake.calls[0] == "start"
    assert fake.calls.count("get:None") == 3  # 2 in-progress polls + first page
    assert "get:p2" in fake.calls


def test_large_png_falls_back_to_async():
    fake = FakeTextract()
    fake.polls_before_done = 0
    p = TextractProcessor(client=fake, bucket="b", max_sync_bytes=10, sleep=lambda _s: None)
    p.extract_text(b"x" * 11, "big.png", "image/png", storage_uri="s3://b/k")
    assert fake.calls[0] == "start"


def test_pdf_without_storage_uri_is_an_error():
    p = TextractProcessor(client=FakeTextract(), bucket="b")
    with pytest.raises(ValueError):
        p.extract_text(b"%PDF", "t.pdf", "application/pdf")


def test_async_failure_and_timeout_surface():
    class Failing(FakeTextract):
        def get_document_text_detection(self, JobId: str, NextToken: str | None = None) -> dict:
            return {"JobStatus": "FAILED", "StatusMessage": "bad scan"}

    p = TextractProcessor(client=Failing(), bucket="b", sleep=lambda _s: None)
    with pytest.raises(RuntimeError, match="bad scan"):
        p.extract_text(b"%PDF", "t.pdf", "application/pdf", storage_uri="s3://b/k")

    slow = FakeTextract()
    slow.polls_before_done = 10**6
    p = TextractProcessor(client=slow, bucket="b", async_timeout_seconds=0, sleep=lambda _s: None)
    with pytest.raises(TimeoutError):
        p.extract_text(b"%PDF", "t.pdf", "application/pdf", storage_uri="s3://b/k")


def test_parse_s3_uri():
    assert parse_s3_uri("s3://bucket/a/b.pdf") == ("bucket", "a/b.pdf")
    with pytest.raises(ValueError):
        parse_s3_uri("https://bucket/a")


# ------------------------------------------------------------ B-14 fail fast


def test_production_boot_fails_loudly_without_aws(monkeypatch):
    monkeypatch.setattr(deps, "DynamoRepository", lambda **_: (_ for _ in ()).throw(RuntimeError("no creds")))
    settings = Settings({**os.environ, "DEMO_MODE": "false", "MOCK_LLM": "true"})
    with pytest.raises(RuntimeError, match="DynamoRepository could not be initialised"):
        deps.Services(settings)


# ------------------------------------------------------------------ I-6 TTL


def test_ttl_attribute_written_and_stripped_on_read():
    fake = FakeDynamo()
    r = DynamoRepository("wf", "docs", "audit", client=fake, retention_days=1)
    r.save_document(DocumentRecord(workflow_id="w", document_id="d", filename="f", mime_type="image/png"))
    item = next(iter(fake.tables["docs"].values()))
    assert "N" in item["expiresAt"] and int(item["expiresAt"]["N"]) > 1_700_000_000
    assert r.get_document("w", "d") is not None  # extra attribute does not break the model

    no_ttl = DynamoRepository("wf", "docs2", "audit", client=fake, retention_days=0)
    no_ttl.save_document(DocumentRecord(workflow_id="w", document_id="d", filename="f", mime_type="image/png"))
    assert "expiresAt" not in next(iter(fake.tables["docs2"].values()))
