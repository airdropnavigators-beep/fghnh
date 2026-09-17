"""FlowForge evaluation harness.

Measures the six metrics from the spec against a ground-truth dataset. By default
it evaluates the deterministic DEMO_MODE pipeline (MockLLMProvider +
MockDocumentProcessor); `--provider bedrock` evaluates the real AWS adapters when
credentials are available.

Only measured numbers are reported. Nothing here fabricates a result: if a metric
is not computable it is reported as null with a reason.

Run from the repository root:

    backend/.venv/Scripts/python.exe evaluation/run_evaluation.py
    backend/.venv/Scripts/python.exe evaluation/run_evaluation.py --strict
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.ai.mock_llm_provider import MockLLMProvider  # noqa: E402
from app.ai.workflow_generator import WorkflowGenerator, load_knowledge  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.documents.mock_processor import MockDocumentProcessor  # noqa: E402
from app.models.document import ExtractedField  # noqa: E402
from app.workflow.schema_validator import validate  # noqa: E402

KNOWLEDGE_PATH = BACKEND / "knowledge" / "scholarship_process.json"
GROUND_TRUTH_PATH = REPO_ROOT / "evaluation" / "ground_truth" / "documents.json"
TEST_DOCS_DIR = REPO_ROOT / "evaluation" / "test_documents"
RESULTS_DIR = REPO_ROOT / "evaluation" / "results"

TARGETS = {
    "workflow_generation_validity": 0.95,
    "classification_accuracy": 0.90,
    "field_extraction_accuracy": 0.85,
    "conflict_detection_accuracy": 0.80,
    "workflow_generation_latency_ms": 5000.0,
    "document_processing_latency_ms": 10000.0,
}

GENERATION_GOALS = [
    "I want to apply for the Merit Excellence Scholarship",
    "Apply for the merit scholarship for my computer science degree",
    "Submit my application for the Merit Excellence Scholarship",
    "I need financial aid through the Merit Excellence Scholarship",
    "Apply to the scholarship with my transcript and essay",
    "Please start my Merit Excellence Scholarship application",
    "Help me apply for the Merit Excellence Scholarship this year",
    "I would like to be considered for the Merit Excellence Scholarship",
    "Begin the application process for the merit scholarship",
    "Apply for a scholarship that requires my GPA and documents",
    "Submit documents for the Merit Excellence Scholarship",
    "Start a scholarship application workflow",
]


@dataclass
class Metric:
    name: str
    value: float | None
    unit: str
    target: float
    passed: bool
    samples: int
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": None if self.value is None else round(self.value, 4),
            "unit": self.unit,
            "target": self.target,
            "passed": self.passed,
            "samples": self.samples,
            "detail": self.detail,
        }


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((pct / 100) * (len(ordered) - 1))))
    return ordered[index]


def _norm(value: Any) -> str:
    return str(value).strip().lower()


class Evaluator:
    def __init__(self, provider: Any, processor: Any, settings: Settings) -> None:
        self.provider = provider
        self.processor = processor
        self.settings = settings
        self.knowledge = load_knowledge(str(KNOWLEDGE_PATH))
        self.requirements = self.knowledge["process"]["requirements"]
        self.ground_truth = json.loads(GROUND_TRUTH_PATH.read_text(encoding="utf-8"))

    # --- individual metrics ---

    def workflow_generation(self) -> Metric:
        generator = WorkflowGenerator(self.provider, self.settings)
        valid = 0
        latencies: list[float] = []
        failures: list[str] = []
        for goal in GENERATION_GOALS:
            start = time.perf_counter()
            try:
                wf = generator.generate(goal, self.knowledge)
                report = validate(wf)
                ok = report.valid
            except Exception as exc:  # noqa: BLE001
                ok = False
                failures.append(f"{goal!r}: {exc}")
            latencies.append((time.perf_counter() - start) * 1000)
            valid += int(ok)
        value = valid / len(GENERATION_GOALS)
        return Metric(
            name="workflow_generation_validity",
            value=value,
            unit="ratio",
            target=TARGETS["workflow_generation_validity"],
            passed=value >= TARGETS["workflow_generation_validity"],
            samples=len(GENERATION_GOALS),
            detail={"invalid": failures},
        )

    def _read_doc(self, filename: str) -> tuple[bytes, str]:
        path = TEST_DOCS_DIR / filename
        content = path.read_bytes() if path.exists() else b""
        return content, "application/pdf"

    def _process_doc(self, filename: str) -> tuple[str, dict[str, ExtractedField], float]:
        content, mime = self._read_doc(filename)
        start = time.perf_counter()
        text = self.processor.extract_text(content, filename, mime)
        classification = self.provider.classify_document(text)
        fields = self.provider.extract_fields(text, classification.classification)
        elapsed = (time.perf_counter() - start) * 1000
        return classification.classification, fields, elapsed

    def classification(self) -> Metric:
        correct = 0
        mismatches: list[dict[str, str]] = []
        for doc in self.ground_truth["documents"]:
            predicted, _, _ = self._process_doc(doc["file"])
            expected = doc["expected_classification"]
            if predicted == expected:
                correct += 1
            else:
                mismatches.append({"file": doc["file"], "expected": expected, "predicted": predicted})
        total = len(self.ground_truth["documents"])
        value = correct / total
        return Metric(
            name="classification_accuracy",
            value=value,
            unit="ratio",
            target=TARGETS["classification_accuracy"],
            passed=value >= TARGETS["classification_accuracy"],
            samples=total,
            detail={"mismatches": mismatches},
        )

    def field_extraction(self) -> Metric:
        matched = 0
        total = 0
        failures: list[dict[str, Any]] = []
        for doc in self.ground_truth["documents"]:
            _, fields, _ = self._process_doc(doc["file"])
            for name, expected in doc.get("expected_fields", {}).items():
                total += 1
                actual = fields.get(name)
                if actual is not None and _norm(actual.value) == _norm(expected):
                    matched += 1
                else:
                    failures.append(
                        {
                            "file": doc["file"],
                            "field": name,
                            "expected": expected,
                            "actual": None if actual is None else actual.value,
                        }
                    )
            for name in doc.get("expected_missing_fields", []):
                total += 1
                if name not in fields:
                    matched += 1
                else:
                    failures.append(
                        {"file": doc["file"], "field": name, "expected": "<absent>", "actual": fields[name].value}
                    )
        value = matched / total if total else 0.0
        return Metric(
            name="field_extraction_accuracy",
            value=value,
            unit="ratio",
            target=TARGETS["field_extraction_accuracy"],
            passed=value >= TARGETS["field_extraction_accuracy"],
            samples=total,
            detail={"failures": failures},
        )

    def conflict_detection(self) -> Metric:
        correct = 0
        failures: list[dict[str, str]] = []
        scenarios = self.ground_truth["validation_scenarios"]
        for scenario in scenarios:
            extracted: dict[str, dict[str, ExtractedField]] = {}
            for filename in scenario["documents"]:
                classification, fields, _ = self._process_doc(filename)
                extracted[classification] = fields
            result = self.provider.run_cross_validation(self.requirements, extracted)
            predicted = result.status.value
            if predicted == scenario["expected_status"]:
                correct += 1
            else:
                failures.append(
                    {"scenario": scenario["name"], "expected": scenario["expected_status"], "predicted": predicted}
                )
        value = correct / len(scenarios) if scenarios else 0.0
        return Metric(
            name="conflict_detection_accuracy",
            value=value,
            unit="ratio",
            target=TARGETS["conflict_detection_accuracy"],
            passed=value >= TARGETS["conflict_detection_accuracy"],
            samples=len(scenarios),
            detail={"failures": failures},
        )

    def generation_latency(self) -> Metric:
        generator = WorkflowGenerator(self.provider, self.settings)
        latencies: list[float] = []
        for goal in GENERATION_GOALS:
            start = time.perf_counter()
            generator.generate(goal, self.knowledge)
            latencies.append((time.perf_counter() - start) * 1000)
        mean = statistics.fmean(latencies)
        return Metric(
            name="workflow_generation_latency_ms",
            value=mean,
            unit="ms",
            target=TARGETS["workflow_generation_latency_ms"],
            passed=mean <= TARGETS["workflow_generation_latency_ms"],
            samples=len(latencies),
            detail={"p50": round(_percentile(latencies, 50), 3), "p95": round(_percentile(latencies, 95), 3)},
        )

    def document_latency(self) -> Metric:
        latencies: list[float] = []
        for doc in self.ground_truth["documents"]:
            _, _, elapsed = self._process_doc(doc["file"])
            latencies.append(elapsed)
        mean = statistics.fmean(latencies)
        return Metric(
            name="document_processing_latency_ms",
            value=mean,
            unit="ms",
            target=TARGETS["document_processing_latency_ms"],
            passed=mean <= TARGETS["document_processing_latency_ms"],
            samples=len(latencies),
            detail={"p50": round(_percentile(latencies, 50), 3), "p95": round(_percentile(latencies, 95), 3)},
        )

    def run(self) -> list[Metric]:
        return [
            self.workflow_generation(),
            self.classification(),
            self.field_extraction(),
            self.conflict_detection(),
            self.generation_latency(),
            self.document_latency(),
        ]


def _build_components(provider_name: str) -> tuple[Any, Any, Settings]:
    if provider_name == "bedrock":
        from app.ai.bedrock_provider import BedrockProvider
        from app.documents.aws_processor import TextractProcessor

        settings = Settings({"DEMO_MODE": "false"})
        return BedrockProvider(settings), TextractProcessor(settings), settings
    settings = Settings({"DEMO_MODE": "true"})
    return MockLLMProvider(), MockDocumentProcessor(), settings


def _print_report(metrics: list[Metric], provider_name: str) -> None:
    print(f"\nFlowForge evaluation — provider: {provider_name}")
    print("=" * 78)
    print(f"{'metric':<34}{'value':>12}{'target':>12}{'samples':>9}  status")
    print("-" * 78)
    for m in metrics:
        if m.value is None:
            value = "n/a"
        elif m.unit == "ratio":
            value = f"{m.value * 100:.1f}%"
        else:
            value = f"{m.value:.2f}ms"
        target = f"{m.target * 100:.0f}%" if m.unit == "ratio" else f"{m.target:.0f}ms"
        status = "PASS" if m.passed else "FAIL"
        print(f"{m.name:<34}{value:>12}{target:>12}{m.samples:>9}  {status}")
    print("=" * 78)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the FlowForge evaluation suite.")
    parser.add_argument("--provider", choices=["mock", "bedrock"], default="mock")
    parser.add_argument("--strict", action="store_true", help="exit non-zero if a metric misses its target")
    parser.add_argument("--out", type=Path, default=None, help="explicit results file path")
    args = parser.parse_args()

    provider, processor, settings = _build_components(args.provider)
    evaluator = Evaluator(provider, processor, settings)
    metrics = evaluator.run()
    _print_report(metrics, args.provider)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = args.out or RESULTS_DIR / f"eval_{args.provider}_{timestamp}.json"
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider": args.provider,
        "demo_mode": settings.demo_mode,
        "metrics": {m.name: m.to_dict() for m in metrics},
        "all_passed": all(m.passed for m in metrics),
    }
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nresults written to {out_path}")

    if args.strict and not payload["all_passed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
