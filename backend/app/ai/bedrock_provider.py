"""Amazon Bedrock-backed LLM provider.

Controlled AI components only: workflow generation, document classification,
field extraction, and cross-validation. Each call requests strict JSON output and
parses/validates it. Uses exponential backoff on throttling and always treats
document text as untrusted data (see prompt_utils).
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from ..core.confidence import clamped
from ..core.config import Settings
from ..models.document import (
    ClassificationResult,
    CrossValidationResult,
    ExtractedField,
    ValidationIssue,
    ValidationSeverity,
    ValidationStatus,
)
from .llm_provider import LLMProvider
from .prompt_utils import wrap_untrusted_document

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


class BedrockProvider(LLMProvider):
    def __init__(self, settings: Settings, client: Any = None) -> None:
        self._settings = settings
        if client is not None:
            self._client = client
        else:
            import boto3

            self._client = boto3.client("bedrock-runtime", region_name=settings.bedrock_region)

    def name(self) -> str:
        return "bedrock"

    # --- shared invocation ---

    def _invoke_anthropic(self, system: str, prompt: str, model_id: str | None = None) -> dict:
        from botocore.exceptions import ClientError

        model = model_id or self._settings.bedrock_model_id
        body = json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 4096,
                "temperature": 0.2,
                "system": system,
                "messages": [{"role": "user", "content": prompt}],
            }
        )
        last_error: Exception | None = None
        for attempt in range(self._settings.bedrock_max_retries):
            try:
                resp = self._client.invoke_model(
                    modelId=model,
                    accept="application/json",
                    contentType="application/json",
                    body=body.encode("utf-8"),
                )
                payload = json.loads(resp["body"].read().decode("utf-8"))
                content = payload.get("content") or []
                text = content[0].get("text", "") if content else ""
                return _extract_json(text)
            except ClientError as exc:
                last_error = exc
                code = exc.response.get("Error", {}).get("Code", "")
                if code in {"ThrottlingException", "ThrottledException"}:
                    delay = self._settings.bedrock_retry_base_seconds * (2 ** attempt)
                    logger.warning("Bedrock throttled, retrying in %.1fs (%d)", delay, attempt + 1)
                    time.sleep(delay)
                    continue
                raise
            except Exception as exc:  # noqa: BLE001 - normalized below
                last_error = exc
                break
        raise RuntimeError(f"Bedrock invocation failed after retries: {last_error}")

    # --- workflow generation ---

    def generate_workflow(self, goal: str, knowledge: dict) -> dict:
        system = _read_prompt(_PROMPTS_DIR / "workflow_generator.txt")
        prompt_lines = [
            "# Process knowledge (trusted, from the application owner)",
            json.dumps(knowledge.get("process", knowledge), default=str),
            "",
            "# User goal (untrusted)",
            json.dumps(goal),
            "",
            "Return ONLY the workflow JSON object.",
        ]
        raw = self._invoke_anthropic(system, "\n".join(prompt_lines), self._settings.bedrock_fast_model_id)
        return raw

    # --- document intelligence ---

    def classify_document(self, text: str) -> ClassificationResult:
        system = _read_prompt(_PROMPTS_DIR / "document_classifier.txt")
        prompt = (
            wrap_untrusted_document(text)
            + "\n\nReturn ONLY JSON: {\"classification\": ..., \"confidence\": 0.0-1.0, \"reasoning\": \"...\"}"
        )
        raw = self._invoke_anthropic(system, prompt, self._settings.bedrock_fast_model_id)
        return ClassificationResult(
            classification=str(raw.get("classification", "other")),
            confidence=clamped(float(raw.get("confidence", 0.0))),
            reasoning=str(raw.get("reasoning", "")),
        )

    def extract_fields(self, text: str, classification: str) -> dict[str, ExtractedField]:
        system = _read_prompt(_PROMPTS_DIR / "field_extractor.txt")
        allowed = (
            _read_prompt(_PROMPTS_DIR / "field_schema.txt").split("\n")
            if (_PROMPTS_DIR / "field_schema.txt").exists()
            else []
        )
        prompt = (
            f"Document classification: {classification}\n"
            + ("Allowed fields:\n" + "\n".join(allowed) + "\n" if allowed else "")
            + wrap_untrusted_document(text)
            + '\n\nReturn ONLY JSON: {"fields": {"<field>": {"value": ..., "confidence": 0.0-1.0, '
            + '"source_text": "exact text from the document"}}}'
        )
        raw = self._invoke_anthropic(system, prompt, self._settings.bedrock_fast_model_id)
        fields: dict[str, ExtractedField] = {}
        for key, entry in (raw.get("fields") or {}).items():
            try:
                fields[key] = ExtractedField.model_validate(entry)
            except Exception:  # noqa: BLE001 - skip malformed entries
                continue
        return fields

    def run_cross_validation(
        self,
        requirements: dict[str, Any],
        extracted_fields: dict[str, dict[str, ExtractedField]],
    ) -> CrossValidationResult:
        system = _read_prompt(_PROMPTS_DIR / "cross_validator.txt")
        payload = {
            "requirements": requirements,
            "documents": {
                doc: {k: f.model_dump() for k, f in fields.items()}
                for doc, fields in extracted_fields.items()
            },
        }
        prompt = (
            json.dumps(payload, default=str)
            + "\n\nReturn ONLY JSON: {\"status\": \"pass|needs_review|block\", "
            + "\"confidence\": 0.0-1.0, \"issues\": [{\"severity\": \"info|warning|error\", "
            + "\"field\": \"...\", \"message\": \"...\", \"evidence\": [\"...\"]}], \"suggestions\": [...]}"
        )
        raw = self._invoke_anthropic(system, prompt)
        return CrossValidationResult(
            status=_coerce_enum(ValidationStatus, raw.get("status"), ValidationStatus.NEEDS_REVIEW),
            confidence=clamped(float(raw.get("confidence", 0.0))),
            issues=[
                ValidationIssue(
                    severity=_coerce_enum(
                        ValidationSeverity, i.get("severity"), ValidationSeverity.WARNING
                    ),
                    field=str(i.get("field", "")),
                    message=str(i.get("message", "")),
                    evidence=list(i.get("evidence", [])),
                    suggestion=i.get("suggestion"),
                )
                for i in raw.get("issues", [])
            ],
            suggestions=[str(s) for s in raw.get("suggestions", [])],
            checked_documents=sorted(extracted_fields),
        )


def _coerce_enum(enum_cls: type, value: Any, default: Any) -> Any:
    """Best-effort coercion of an untrusted model value to a domain enum.

    Model output is data, not a contract: an unexpected label must degrade to a
    safe default rather than crash the request.
    """
    try:
        return enum_cls(value)
    except (ValueError, TypeError):
        logger.warning("unexpected %s value %r; defaulting to %s", enum_cls.__name__, value, default)
        return default


def _read_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def _extract_json(text: str) -> dict:
    """Robustly extract a JSON object from a model response."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(line for line in cleaned.splitlines() if not line.startswith("```"))
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise ValueError("model response did not contain a JSON object") from exc
