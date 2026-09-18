#!/usr/bin/env bash
# Durable sandbox setup: frontend deps + backend venv (DEMO_MODE, no AWS needed).
set -euo pipefail
cd "$(dirname "$0")/.."

(cd frontend && npm install --no-audit --no-fund)

cd backend
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt
if [ ! -f .env ]; then
  cp ../.env.example .env
fi
