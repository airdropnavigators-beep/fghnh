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
        if self.settings.demo_mode:
            logger.info("DEMO_MODE enabled: using MockLLMProvider")
            return MockLLMProvider()
        try:
            return BedrockProvider(self.settings)
        except Exception as exc:  # noqa: BLE001 - fall back so the app still boots
            logger.warning("BedrockProvider unavailable (%s); falling back to MockLLMProvider", exc)
            return MockLLMProvider()

    def _build_repo(self) -> WorkflowRepository:
        if self.settings.demo_mode:
            return InMemoryRepository()
        try:
            return DynamoRepository(
                table_workflows=self.settings.aws_ddb_workflows,
                table_documents=self.settings.aws_ddb_documents,
                table_audit=self.settings.aws_ddb_audit,
                region=self.settings.bedrock_region,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("DynamoRepository unavailable (%s); falling back to InMemoryRepository", exc)
            return InMemoryRepository()

    def _build_documents(self):
        if self.settings.demo_mode:
            return MockObjectStore(), MockDocumentProcessor()
        try:
            return (
                S3ObjectStore(self.settings.aws_s3_bucket, self.settings.bedrock_region),
                TextractProcessor(self.settings.bedrock_region),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("AWS document services unavailable (%s); falling back to mocks", exc)
            return MockObjectStore(), MockDocumentProcessor()


@lru_cache
def get_services() -> Services:
    return Services(get_settings())


def _load_knowledge(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
