"""AWS DynamoDB-backed repository.

Implements the same WorkflowRepository interface as InMemoryRepository so the
application is portable between DEMO_MODE and deployed AWS. Tables: Workflows,
Documents, AuditLog (see ARCHITECTURE.md). Uses boto3; requires AWS credentials
and is only exercised when DEMO_MODE=false.

Storage conventions
- Numbers are stored as DynamoDB ``N`` (Decimal) values, never as strings, so
  ``details.confidence`` round-trips as a number.
- The audit sort key is ``"<timestamp>#<event_id>"``: two events emitted in the
  same microsecond can no longer overwrite each other. Legacy rows keyed by the
  bare timestamp are still readable.
- Every query follows ``LastEvaluatedKey`` so long trails are never truncated.
"""

from __future__ import annotations

import json
import time
from decimal import Decimal
from typing import Any, Iterator

from ..models.audit import AuditEvent
from ..models.document import DocumentRecord
from ..models.workflow import Workflow
from .repository import WorkflowRepository

_SK_SEPARATOR = "#"


class DynamoRepository(WorkflowRepository):
    def __init__(
        self,
        table_workflows: str,
        table_documents: str,
        table_audit: str,
        region: str = "us-east-1",
        client: Any = None,
        retention_days: int = 0,
    ) -> None:
        if client is not None:
            self._ddb = client
        else:
            import boto3

            self._ddb = boto3.client("dynamodb", region_name=region)
        self._table_workflows = table_workflows
        self._table_documents = table_documents
        self._table_audit = table_audit
        self._retention_days = retention_days

    def _ttl(self) -> dict[str, int]:
        """`expiresAt` epoch seconds for the tables' TTL attribute (omitted when disabled)."""
        if self._retention_days <= 0:
            return {}
        return {"expiresAt": int(time.time()) + self._retention_days * 86_400}

    # --- Workflows ---
    def save_workflow(self, workflow: Workflow) -> None:
        self._ddb.put_item(
            TableName=self._table_workflows,
            Item=_dumps({**workflow.model_dump(), **self._ttl(), "workflowId": workflow.workflow_id}),
        )

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        resp = self._ddb.get_item(
            TableName=self._table_workflows, Key={"workflowId": {"S": workflow_id}}
        )
        item = resp.get("Item")
        if not item:
            return None
        data = _loads(item)
        for key in ("workflowId", "expiresAt"):
            data.pop(key, None)
        return Workflow.model_validate(data)

    # --- Documents ---
    def save_document(self, doc: DocumentRecord) -> None:
        self._ddb.put_item(
            TableName=self._table_documents,
            Item=_dumps(
                {**doc.model_dump(), **self._ttl(), "workflowId": doc.workflow_id, "documentId": doc.document_id}
            ),
        )

    def get_document(self, workflow_id: str, document_id: str) -> DocumentRecord | None:
        resp = self._ddb.get_item(
            TableName=self._table_documents,
            Key={"workflowId": {"S": workflow_id}, "documentId": {"S": document_id}},
        )
        item = resp.get("Item")
        if not item:
            return None
        data = _loads(item)
        for key in ("workflowId", "documentId", "expiresAt"):
            data.pop(key, None)
        return DocumentRecord.model_validate(data)

    def list_documents(self, workflow_id: str) -> list[DocumentRecord]:
        docs: list[DocumentRecord] = []
        for item in self._query_all(self._table_documents, workflow_id):
            data = _loads(item)
            for key in ("workflowId", "documentId", "expiresAt"):
                data.pop(key, None)
            docs.append(DocumentRecord.model_validate(data))
        return docs

    # --- Audit ---
    def append_audit(self, event: AuditEvent) -> None:
        # Composite sort key keeps ordering by time while guaranteeing uniqueness.
        sort_key = f"{event.timestamp}{_SK_SEPARATOR}{event.event_id}"
        # Key attributes are set last so the model's own `timestamp` cannot clobber them.
        item = {**event.model_dump(), **self._ttl(), "workflowId": event.workflow_id, "timestamp": sort_key}
        self._ddb.put_item(
            TableName=self._table_audit,
            Item=_dumps(item),
            # Defensive: never overwrite an existing audit row.
            ConditionExpression="attribute_not_exists(#ts)",
            ExpressionAttributeNames={"#ts": "timestamp"},
        )

    def list_audit(self, workflow_id: str) -> list[AuditEvent]:
        events: list[AuditEvent] = []
        for item in self._query_all(self._table_audit, workflow_id):
            data = _loads(item)
            for key in ("workflowId", "expiresAt"):
                data.pop(key, None)
            sort_key = str(data.pop("timestamp", ""))
            # Legacy rows: bare timestamp as sort key, "None" strings for nulls.
            if data.get("confidence") == "None":
                data["confidence"] = None
            for key in ("from_state", "to_state"):
                if data.get(key) == "None":
                    data[key] = None
            data["timestamp"] = sort_key.split(_SK_SEPARATOR, 1)[0]
            events.append(AuditEvent.model_validate(data))
        # Python's sort is stable: equal timestamps keep DynamoDB's sort-key order.
        events.sort(key=lambda e: e.timestamp)
        return events

    # --- internals ---
    def _query_all(self, table: str, workflow_id: str) -> Iterator[dict[str, Any]]:
        """Yield every item for a partition, following pagination."""
        kwargs: dict[str, Any] = {
            "TableName": table,
            "KeyConditionExpression": "workflowId = :wid",
            "ExpressionAttributeValues": {":wid": {"S": workflow_id}},
        }
        while True:
            resp = self._ddb.query(**kwargs)
            yield from resp.get("Items", [])
            last = resp.get("LastEvaluatedKey")
            if not last:
                return
            kwargs["ExclusiveStartKey"] = last


def _dumps(obj: dict[str, Any]) -> dict[str, Any]:
    """Convert a Python dictionary into DynamoDB AttributeValue format."""
    # Enums/datetimes become strings via `default=str`; numbers are preserved because
    # json round-trip keeps int/float, which _convert stores as N.
    normalized = json.loads(json.dumps(obj, default=str))
    return {str(key): _convert(value) for key, value in normalized.items()}


def _loads(item: dict[str, Any]) -> dict[str, Any]:
    """Convert a DynamoDB item back into ordinary Python values."""
    return {key: _unconvert(value) for key, value in item.items()}


def _convert(value: Any) -> dict[str, Any]:
    if value is None:
        return {"NULL": True}
    if isinstance(value, bool):
        return {"BOOL": value}
    if isinstance(value, (int, float, Decimal)):
        # DynamoDB numbers are arbitrary-precision decimals; repr() keeps float precision.
        text = repr(value) if isinstance(value, float) else str(value)
        return {"N": text}
    if isinstance(value, str):
        return {"S": value}
    if isinstance(value, list):
        return {"L": [_convert(v) for v in value]}
    if isinstance(value, dict):
        return {"M": {str(k): _convert(v) for k, v in value.items()}}
    return {"S": str(value)}


def _unconvert(attr: dict[str, Any]) -> Any:
    if "NULL" in attr:
        return None
    if "S" in attr:
        return attr["S"]
    if "N" in attr:
        raw = str(attr["N"])
        if "." in raw or "e" in raw.lower():
            return float(raw)
        return int(raw)
    if "BOOL" in attr:
        return attr["BOOL"]
    if "L" in attr:
        return [_unconvert(a) for a in attr["L"]]
    if "M" in attr:
        return {k: _unconvert(v) for k, v in attr["M"].items()}
    return None
