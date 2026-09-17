"""Production-hardening regression tests.

Covers the contract guarantees added on top of the happy path: normalized `needs`
labels on reads, typed not-found errors, non-leaking 500s, bounded uploads,
unique audit/correlation ids, and value-isolated repository reads.
"""

from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_services
from app.api.routes import _http, router
from app.core.config import override_settings
from app.models.enums import StateType
from app.models.workflow import State, Workflow
from app.services.workflow_service import _next_confirmation_id
from app.storage.in_memory import InMemoryRepository
from app.workflow.errors import WorkflowNotFound
from app.workflow.state_machine import needs_label

GOAL = "I want to apply for the Merit Excellence Scholarship"
DOCS = [
    ("transcript.pdf", b"%PDF-1.4 fictional transcript", "application/pdf"),
    ("government_id.pdf", b"%PDF-1.4 fictional government id", "application/pdf"),
    ("income_certificate.pdf", b"%PDF-1.4 fictional income certificate", "application/pdf"),
    ("personal_essay.pdf", b"%PDF-1.4 fictional essay", "application/pdf"),
]


@pytest.fixture(scope="module")
def client() -> TestClient:
    override_settings({**os.environ, "DEMO_MODE": "true"})
    get_services.cache_clear()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _create(client: TestClient) -> str:
    r = client.post("/workflows", json={"goal": GOAL})
    assert r.status_code == 200
    return r.json()["workflow_id"]


def test_get_returns_normalized_needs_label(client):
    wid = _create(client)
    client.post(f"/workflows/{wid}/advance", json={})

    detail = client.get(f"/workflows/{wid}").json()
    assert detail["needs"] == "document_upload"
    assert detail["current_state"] == "document_collection"


def test_needs_label_is_single_source_of_truth():
    assert needs_label(State(id="a", label="a", type=StateType.HUMAN_APPROVAL)) == "approval"
    assert needs_label(State(id="b", label="b", type=StateType.DOCUMENT_REQUIRED)) == "document_upload"
    assert needs_label(State(id="c", label="c", type=StateType.USER_INPUT)) == "user_input"
    assert needs_label(State(id="d", label="d", type=StateType.AUTOMATIC)) == "action"


def test_missing_workflow_is_typed_404(client):
    r = client.post("/workflows/wf_does_not_exist/advance", json={})
    assert r.status_code == 404
    assert "not found" in r.json()["detail"]

    r = client.get("/workflows/wf_does_not_exist")
    assert r.status_code == 404


def test_service_advance_raises_workflow_not_found():
    services = get_services()
    with pytest.raises(WorkflowNotFound):
        services.workflow_service.advance("wf_missing", None)


def test_unhandled_error_does_not_leak_internals():
    err = _http(RuntimeError("super-secret-internal-detail"))
    assert err.status_code == 500
    assert err.detail == "Internal server error"
    assert "super-secret" not in err.detail


def test_known_errors_keep_specific_detail():
    err = _http(WorkflowNotFound("workflow 'x' not found"))
    assert err.status_code == 404
    assert "not found" in err.detail


def test_oversized_upload_is_rejected_before_processing(client):
    wid = _create(client)
    services = get_services()
    original = services.settings.max_document_size_mb
    services.settings.max_document_size_mb = 1
    try:
        too_big = b"x" * (1024 * 1024 + 1)
        r = client.post(
            f"/workflows/{wid}/documents",
            files={"file": ("huge.pdf", too_big, "application/pdf")},
        )
        assert r.status_code == 413
    finally:
        services.settings.max_document_size_mb = original


def test_audit_events_have_unique_ids(client):
    wid = _create(client)
    client.post(f"/workflows/{wid}/advance", json={})
    for name, content, mime in DOCS:
        client.post(f"/workflows/{wid}/documents", files={"file": (name, content, mime)})
    client.post(f"/workflows/{wid}/advance", json={})

    events = client.get(f"/workflows/{wid}/audit").json()["events"]
    ids = [e["event_id"] for e in events]
    assert ids and all(ids)
    assert len(ids) == len(set(ids))


def test_confirmation_ids_are_unique():
    ids = {_next_confirmation_id() for _ in range(50)}
    assert len(ids) == 50
    assert all(i.startswith("FF-") for i in ids)


def test_repository_reads_are_value_isolated():
    repo = InMemoryRepository()
    wf = Workflow(
        workflow_id="wf_iso",
        goal="g",
        initial_state="start",
        terminal_states=["done"],
        states=[
            State(id="start", label="start", type=StateType.AUTOMATIC),
            State(id="done", label="done", type=StateType.TERMINAL),
        ],
    )
    repo.save_workflow(wf)

    fetched = repo.get_workflow("wf_iso")
    assert fetched is not None
    fetched.goal = "mutated"
    assert repo.get_workflow("wf_iso").goal == "g"
