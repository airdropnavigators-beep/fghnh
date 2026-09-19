#!/usr/bin/env bash
# Managed preview: FastAPI backend (DEMO_MODE) on :8000 + Vite frontend on :5173.
# The frontend proxies /api -> :8000; set VITE_USE_MOCK=false to exercise the live path.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${HOPLITE_PREVIEW_MANIFEST_PATH:-}" ]; then
  printf '{"version":1,"generation":"%s","profile":"default","runId":"%s","ports":{"preview":5173,"api":8000}}' \
    "${HOPLITE_PREVIEW_GENERATION:-0}" "${HOPLITE_PREVIEW_RUN:-}" > "$HOPLITE_PREVIEW_MANIFEST_PATH"
fi

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

(cd backend && exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000) &
PIDS+=($!)

(cd frontend && VITE_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS:-true}" \
  exec npx vite --host 0.0.0.0 --port 5173 --strictPort) &
PIDS+=($!)

# Exit (and tear down the sibling) as soon as either server dies.
wait -n
