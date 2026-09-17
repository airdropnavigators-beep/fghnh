"""Central logging configuration.

Called once at application startup. Library modules only ever call
``logging.getLogger(__name__)``; all handler/format decisions live here.
"""

from __future__ import annotations

import logging
import sys

_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
_configured = False


def configure_logging(level: str = "INFO") -> None:
    """Install a single stdout handler on the root logger (idempotent)."""
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())
    _configured = True
