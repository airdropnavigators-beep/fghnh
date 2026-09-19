"""Application composition root.

Selects real vs. mock implementations based on DEMO_MODE, so the whole application
runs locally without AWS credentials and deploys unchanged on Lambda.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from ..ai.bedrock_provider import BedrockProvider
from ..ai.llm_provider import LLMProvider
from ..ai.mock_llm_provider import MockLLMProvider
from ..ai.workflow_generator import WorkflowGenerator
from ..core.config import Settings, get_settings
from ..documents.aws_processor import (
    S3ObjectStore,
    TextractProcessor,
    generate_object_key,
)
from ..documents.mock_processor import MockDocumentProcessor, MockObjectStore
from ..services.document_service import DocumentService
from ..services.workflow_service import WorkflowService
from ..storage.dynamo import DynamoRepository
from ..storage.in_memory import InMemoryRepository
from ..storage.repository import WorkflowRepository

logger = logging.getLogger(__name__)

_KNOWLEDGE_PATH = Path(__file__).resolve().parents[2] / "knowledge" / "scholarship_process.json"


class Services:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.knowledge = _load_knowledge(_KNOWLEDGE_PATH)
        self.llm: LLMProvider = self._build_llm()
        self.repo: WorkflowRepository = self._build_repo()
        self.store, self.processor = self._build_documents()
        self.generator = WorkflowGenerator(self.llm, settings)
        self.workflow_service = WorkflowService(
            self.repo, self.generator, self.llm, settings, self.knowledge
        )
        self.document_service = DocumentService(
            repo=self.repo,
            store=self.store,
            processor=self.processor,
            llm=self.llm,
            object_key_fn=generate_object_key,
        )

    def _build_llm(self) -> LLMProvider:
        if self.settings.demo_mode or self.settings.mock_llm:
            logger.info(
                 "Mock LLM enabled: demo_mode=%s mock_llm=%s",
                 self.settings.demo_mode,
                 self.settings.mock_llm,
            )
            return MockLLMProvider()
        return self._build_or_fail("BedrockProvider", lambda: BedrockProvider(self.settings))

    def _build_repo(self) -> WorkflowRepository:
        if self.settings.demo_mode:
            return InMemoryRepository()
        return self._build_or_fail(
            "DynamoRepository",
            lambda: DynamoRepository(
                table_workflows=self.settings.aws_ddb_workflows,
                table_documents=self.settings.aws_ddb_documents,
                table_audit=self.settings.aws_ddb_audit,
                region=self.settings.aws_region,
                retention_days=self.settings.record_retention_days,
            ),
        )

    def _build_documents(self):
        if self.settings.demo_mode:
            return MockObjectStore(), MockDocumentProcessor()
        return self._build_or_fail(
            "AWS document services",
            lambda: (
                S3ObjectStore(self.settings.aws_s3_bucket, self.settings.aws_region),
                TextractProcessor(
                    self.settings.aws_region,
                    bucket=self.settings.aws_s3_bucket,
                    max_sync_bytes=self.settings.textract_sync_max_bytes,
                    async_poll_seconds=self.settings.textract_async_poll_seconds,
                    async_timeout_seconds=self.settings.textract_async_timeout_seconds,
                ),
            ),
        )

    @staticmethod
    def _build_or_fail(name: str, factory):
        """In production a missing dependency is a startup error, not a silent downgrade.

        Falling back to in-memory storage would look healthy while losing every
        workflow between Lambda invocations; refusing to boot surfaces the real
        misconfiguration in the deploy logs instead.
        """
        try:
            return factory()
        except Exception as exc:  # noqa: BLE001 - re-raised with context
            logger.error("%s could not be initialised: %s", name, exc)
            raise RuntimeError(
                f"{name} could not be initialised in DEMO_MODE=false: {exc}. "
                "Set DEMO_MODE=true for a local run or fix the AWS configuration."
            ) from exc


@lru_cache
def get_services() -> Services:
    return Services(get_settings())


def _load_knowledge(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
