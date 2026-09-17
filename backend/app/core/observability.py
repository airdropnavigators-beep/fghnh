"""Structured application logging for CloudWatch."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("flowforge")
logger.setLevel(logging.INFO)


def log_event(event: str, **fields: Any) -> None:
    """Emit one structured JSON log line."""
    payload = {
        "event": event,
        **fields,
    }
    logger.info(json.dumps(payload, default=str, separators=(",", ":")))
