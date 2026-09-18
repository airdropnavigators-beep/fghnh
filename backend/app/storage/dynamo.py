"""AWS DynamoDB-backed repository.

Implements the same WorkflowRepository interface as InMemoryRepository so the
application is portable between DEMO_MODE and deployed AWS. Tables: Workflows,
Documents, AuditLog (see ARCHITECTURE.md). Uses boto3; requires AWS credentials
and is only exercised when DEMO_MODE=false.
"""

from __future__ import annotations

from typing import Any

from ..models.audit import AuditEvent
from ..models.document import DocumentRecord
from ..models.workflow import Workflow
from .repository import WorkflowRepository


class DynamoRepository(WorkflowRepository):
    def __init__(
        self,
        table_workflows: str,
        table_documents: str,
        table_audit: str,
        region: str = "us-east-1",
        client: Any = None,
    ) -> None:
        if client is not None:
            self._ddb = client
        else:
            import boto3

            self._ddb = boto3.client("dynamodb", region_name=region)
        self._table_workflows = table_workflows
        self._table_documents = table_documents
        self._table_audit = table_audit

    # --- Workflows ---
    def save_workflow(self, workflow: Workflow) -> None:
        self._ddb.put_item(
            TableName=self._table_workflows,
            Item=_dumps({"workflowId": workflow.workflow_id, **workflow.model_dump()}),
        )

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        resp = self._ddb.get_item(
            TableName=self._table_workflows, Key={"workflowId": {"S": workflow_id}}
        )
        item = resp.get("Item")
        if not item:
            return None
        data = _loads(item)
        data.pop("workflowId", None)
        return Workflow.model_validate(data)

    # --- Documents ---
    def save_document(self, doc: DocumentRecord) -> None:
        self._ddb.put_item(
            TableName=self._table_documents,
            Item=_dumps(
                {"workflowId": doc.workflow_id, "documentId": doc.document_id, **doc.model_dump()}
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
        for key in ("workflowId", "documentId"):
            data.pop(key, None)
        return DocumentRecord.model_validate(data)

    def list_documents(self, workflow_id: str) -> list[DocumentRecord]:
        resp = self._ddb.query(
            TableName=self._table_documents,
            KeyConditionExpression="workflowId = :wid",
            ExpressionAttributeValues={":wid": {"S": workflow_id}},
        )
        docs: list[DocumentRecord] = []
        for item in resp.get("Items", []):
            data = _loads(item)
            for key in ("workflowId", "documentId"):
                data.pop(key, None)
            docs.append(DocumentRecord.model_validate(data))
        return docs

    # --- Audit ---
    def append_audit(self, event: AuditEvent) -> None:
        self._ddb.put_item(
            TableName=self._table_audit,
            Item=_dumps({"workflowId": event.workflow_id, "timestamp": event.timestamp, **event.model_dump()}),
        )

    def list_audit(self, workflow_id: str) -> list[AuditEvent]:
        resp = self._ddb.query(
            TableName=self._table_audit,
            KeyConditionExpression="workflowId = :wid",
            ExpressionAttributeValues={":wid": {"S": workflow_id}},
        )

        events: list[AuditEvent] = []

        for item in resp.get("Items", []):
            data = _loads(item)

            for key in ("workflowId", "timestamp"):
                data.pop(key, None)

            # Backward compatibility for older rows.
            if data.get("confidence") == "None":
                data["confidence"] = None

            for key in ("from_state", "to_state"):
                if data.get(key) == "None":
                    data[key] = None

            data["timestamp"] = item.get(
                "timestamp",
                {},
            ).get("S", "")

            events.append(
                AuditEvent.model_validate(data)
            )

        events.sort(key=lambda e: e.timestamp)
        return events


def _dumps(obj: dict[str, Any]) -> dict[str, Any]:
    """Convert a Python dictionary into DynamoDB AttributeValue format."""
    import json

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
    if isinstance(value, int) or isinstance(value, float):
        # DynamoDB has no float type; store as string preserving precision
        if isinstance(value, float):
            return {"S": repr(value)}
        return {"N": str(value)}
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
        raw = attr["N"]
        return float(raw) if "." in raw else int(raw)
    if "BOOL" in attr:
        return attr["BOOL"]
    if "L" in attr:
        return [_unconvert(a) for a in attr["L"]]
    if "M" in attr:
        return {k: _unconvert(v) for k, v in attr["M"].items()}
    return None
