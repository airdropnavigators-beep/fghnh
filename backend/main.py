from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_services
from app.api.routes import router
from app.core.config import get_settings
from app.core.logging_config import configure_logging

settings = get_settings()
configure_logging(settings.log_level)

app = FastAPI(
    title="FlowForge API",
    description="From intent to execution. The LLM plans, the state machine executes, the human stays in control.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health() -> dict:
    return {
        "app": settings.app_name,
        "environment": settings.environment,
        "demo_mode": settings.demo_mode,
        "user": settings.demo_user_id,
    }


@app.get("/")
def root() -> dict:
    return {"name": "FlowForge", "docs": "/docs", "health": "/health"}


# Warm the composition root so providers are constructed once.
get_services()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
