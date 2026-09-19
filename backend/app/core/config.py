"""Central application configuration (env-driven)."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# `backend/.env` (see README "Backend (local)"). Real environment variables win, so a
# deployed Lambda/CI environment is never overridden by a stray file.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(_ENV_FILE, override=False)


class Settings:
    def __init__(self, env: dict[str, str] | None = None) -> None:
        env = env or os.environ
        self.app_name: str = env.get("APP_NAME", "FlowForge")
        self.environment: str = env.get("ENVIRONMENT", "development")
        self.log_level: str = env.get("LOG_LEVEL", "INFO")
        self.demo_mode: bool = env.get("DEMO_MODE", "true").lower() in {"1", "true", "yes"}
        self.mock_llm: bool = env.get("MOCK_LLM", "false").lower() in {"1", "true", "yes"}
        self.demo_user_id: str = env.get("DEMO_USER_ID", "demo-user")

        raw_origins = env.get("CORS_ORIGINS", '["http://localhost:5173"]')
        try:
            self.cors_origins: list[str] = json.loads(raw_origins)
        except json.JSONDecodeError:
            self.cors_origins = ["http://localhost:5173"]

        self.aws_region: str = env.get(
            "AWS_REGION",
            env.get("AWS_DEFAULT_REGION", "us-east-1"),
        )
        self.bedrock_region: str = env.get("BEDROCK_REGION", "us-east-1")
        self.bedrock_model_id: str = env.get(
            "BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20240620-v1:0"
        )
        self.bedrock_fast_model_id: str = env.get(
            "BEDROCK_FAST_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0"
        )
        self.bedrock_max_retries: int = int(env.get("BEDROCK_MAX_RETRIES", "3"))
        self.bedrock_retry_base_seconds: float = float(
            env.get("BEDROCK_RETRY_BASE_SECONDS", "1.0")
        )

        self.aws_s3_bucket: str = env.get("AWS_S3_BUCKET", "flowforge-documents")
        self.aws_ddb_workflows: str = env.get(
            "AWS_DYNAMODB_TABLE_WORKFLOWS", "flowforge-workflows"
        )
        self.aws_ddb_documents: str = env.get(
            "AWS_DYNAMODB_TABLE_DOCUMENTS", "flowforge-documents"
        )
        self.aws_ddb_audit: str = env.get("AWS_DYNAMODB_TABLE_AUDIT", "flowforge-audit")

        self.max_document_size_mb: int = int(env.get("MAX_DOCUMENT_SIZE_MB", "10"))
        # DynamoDB TTL for workflow/document/audit rows; 0 disables. Keep aligned with the
        # S3 lifecycle rule (DocumentRetentionDays) so records never outlive their objects.
        self.record_retention_days: int = int(env.get("RECORD_RETENTION_DAYS", "0"))
        raw_mime = env.get("ALLOWED_MIME_TYPES", '["application/pdf","image/png","image/jpeg"]')
        try:
            self.allowed_mime_types: list[str] = json.loads(raw_mime)
        except json.JSONDecodeError:
            self.allowed_mime_types = ["application/pdf", "image/png", "image/jpeg"]

        # Textract: the synchronous Bytes API accepts PNG/JPEG up to 5 MB only. PDFs and
        # larger images go through the asynchronous S3-backed job (see aws_processor).
        self.textract_sync_max_bytes: int = int(env.get("TEXTRACT_SYNC_MAX_BYTES", str(5 * 1024 * 1024)))
        self.textract_async_poll_seconds: float = float(env.get("TEXTRACT_ASYNC_POLL_SECONDS", "1.5"))
        self.textract_async_timeout_seconds: float = float(env.get("TEXTRACT_ASYNC_TIMEOUT_SECONDS", "60"))

        self.confidence_pass: float = float(env.get("CONFIDENCE_PASS", "0.85"))
        self.confidence_warn: float = float(env.get("CONFIDENCE_WARN", "0.60"))
        self.workflow_retry_on_invalid: bool = (
            env.get("WORKFLOW_RETRY_ON_INVALID", "true").lower() in {"1", "true", "yes"}
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def override_settings(env: dict[str, str]) -> Settings:
    get_settings.cache_clear()
    return Settings(env)
