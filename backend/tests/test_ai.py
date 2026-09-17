"""Tests for the AI providers, workflow generation, and validation gating."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ai.mock_llm_provider import MockLLMProvider
from app.ai.workflow_generator import WorkflowGenerator, load_canonical_workflow, load_knowledge
from app.core.config import Settings
from app.documents.mock_processor import MockDocumentProcessor
from app.models.document import CrossValidationResult, ExtractedField
from app.models.enums import ValidationStatus
from app.models.workflow import State
from app.services.eligibility import check_eligibility
from app.services.workflow_service import _validation_handler
from app.workflow.errors import WorkflowGenerationError
from app.workflow.schema_validator import validate
from app.workflow.state_machine import ExecutionContext

KNOWLEDGE_PATH = str(Path(__file__).resolve().parents[1] / "knowledge" / "scholarship_process.json")


@pytest.fixture
def knowledge() -> dict:
    return load_knowledge(KNOWLEDGE_PATH)


@pytest.fixture
def provider() -> MockLLMProvider:
    return MockLLMProvider()


@pytest.fixture
def reqs(knowledge: dict) -> dict:
    return knowledge["process"]["requirements"]


def transcript_text(variant: str) -> str:
    proc = MockDocumentProcessor()
    return proc.extract_text(b"", f"transcript_{variant}.pdf", "application/pdf")


def test_canonical_workflow_is_schema_valid():
    wf = load_canonical_workflow(KNOWLEDGE_PATH)
    report = validate(wf)
    assert report.valid, report.errors


def test_generator_builds_workflow_from_knowledge(knowledge):
    gen = WorkflowGenerator(MockLLMProvider(), Settings({"DEMO_MODE": "true"}))
    wf = gen.generate("I want to apply for the Merit Excellence Scholarship", knowledge)
    report = validate(wf)
    assert report.valid, report.errors
    assert wf.goal == "I want to apply for the Merit Excellence Scholarship"


def test_generator_retries_then_fails(knowledge):
    class Flaky(MockLLMProvider):
        calls = 0

        def generate_workflow(self, goal, knowledge):
            type(self).calls += 1
            raise RuntimeError("transient failure")

    gen = WorkflowGenerator(Flaky(), Settings({"DEMO_MODE": "true", "WORKFLOW_RETRY_ON_INVALID": "true"}))
    with pytest.raises(WorkflowGenerationError):
        gen.generate("a goal", knowledge)
    assert Flaky.calls == 2  # one attempt + exactly one retry


def test_generator_rejects_invalid_output(knowledge):
    class BadJSON(MockLLMProvider):
        def generate_workflow(self, goal, knowledge):
            return {"not": "a workflow"}

    gen = WorkflowGenerator(BadJSON(), Settings({"DEMO_MODE": "true"}))
    with pytest.raises(WorkflowGenerationError):
        gen.generate("a goal", knowledge)


def test_mock_classifier(provider):
    text = MockDocumentProcessor().extract_text(b"", "government_id.pdf", "application/pdf")
    res = provider.classify_document(text)
    assert res.classification == "government_id"
    assert res.confidence > 0.8


def test_transcript_extraction_conflict(provider):
    fields = provider.extract_fields(transcript_text("conflict"), "academic_transcript")
    assert fields["student_name"].value == "Alex Rivera"
    assert fields["cumulative_gpa"].value == "3.72"
    assert fields["current_semester_gpa"].value == "3.20"
    assert fields["enrollment_status"].value == "Full-time"
    assert fields["expected_graduation"].value == "2027"


def test_transcript_extraction_corrected(provider):
    fields = provider.extract_fields(transcript_text("corrected"), "academic_transcript")
    assert fields["current_semester_gpa"].value == "3.70"


def test_transcript_missing_name_variant(provider):
    fields = provider.extract_fields(transcript_text("missing_name"), "academic_transcript")
    assert "student_name" not in fields
    assert fields["cumulative_gpa"].value == "3.80"


def test_government_id_name_mismatch_variant(provider):
    text = MockDocumentProcessor().extract_text(b"", "government_id_name_mismatch.pdf", "application/pdf")
    fields = provider.extract_fields(text, "government_id")
    assert fields["full_name"].value == "Jordan Blake"


def test_income_certificate_expired_variant(provider):
    text = MockDocumentProcessor().extract_text(b"", "income_certificate_expired.pdf", "application/pdf")
    fields = provider.extract_fields(text, "proof_of_income")
    assert fields["valid_until"].value == "2025-01-31"
    assert fields["annual_income"].value == "24000"


def test_enrollment_verification_classification_and_extraction(provider):
    text = MockDocumentProcessor().extract_text(b"", "enrollment_verification.pdf", "application/pdf")
    res = provider.classify_document(text)
    assert res.classification == "enrollment_verification"
    fields = provider.extract_fields(text, "enrollment_verification")
    assert fields["enrollment_status"].value == "Full-time"
    assert fields["expected_graduation"].value == "2027"


def test_cross_validation_detects_gpa_conflict(provider, reqs):
    fields = provider.extract_fields(transcript_text("conflict"), "academic_transcript")
    result = provider.run_cross_validation(reqs, {"academic_transcript": fields})
    assert result.status == ValidationStatus.NEEDS_REVIEW
    assert any(i.field == "current_semester_gpa" and i.severity.value == "warning" for i in result.issues)


def test_cross_validation_passes_clean(provider, reqs):
    fields = provider.extract_fields(transcript_text("corrected"), "academic_transcript")
    result = provider.run_cross_validation(reqs, {"academic_transcript": fields})
    assert result.status == ValidationStatus.PASS


def test_cross_validation_detects_name_mismatch(provider, reqs):
    transcript = provider.extract_fields(transcript_text("conflict"), "academic_transcript")
    identity = {"full_name": ExtractedField(value="Jane Smith", confidence=0.99, source_text="Name: Jane Smith")}
    result = provider.run_cross_validation(reqs, {"academic_transcript": transcript, "government_id": identity})
    assert result.status == ValidationStatus.NEEDS_REVIEW
    assert any(i.field == "full_name" and i.severity.value == "warning" for i in result.issues)


def test_low_confidence_validation_blocks(provider, reqs):
    low = CrossValidationResult(status=ValidationStatus.PASS, confidence=0.4)

    class Low(provider.__class__):
        def run_cross_validation(self, requirements, extracted):
            return low

    handler = _validation_handler(Low(), reqs, Settings({"DEMO_MODE": "true"}))
    step = handler(State(id="v", label="v", type="validation"), ExecutionContext())
    assert step.data["status"] == "block"


def test_medium_confidence_warns(provider, reqs):
    mid = CrossValidationResult(status=ValidationStatus.PASS, confidence=0.7)

    class Mid(provider.__class__):
        def run_cross_validation(self, requirements, extracted):
            return mid

    handler = _validation_handler(Mid(), reqs, Settings({"DEMO_MODE": "true"}))
    step = handler(State(id="v", label="v", type="validation"), ExecutionContext())
    assert step.data["status"] == "needs_review"


def test_eligibility_is_deterministic(reqs):
    ok, _ = check_eligibility(
        {
            "cumulative_gpa": 3.72,
            "current_semester_gpa": 3.7,
            "enrollment_status": "full_time",
            "expected_graduation": 2027,
        },
        reqs,
    )
    assert ok
    bad, _ = check_eligibility(
        {
            "cumulative_gpa": 2.8,
            "current_semester_gpa": 3.7,
            "enrollment_status": "full_time",
            "expected_graduation": 2027,
        },
        reqs,
    )
    assert not bad
