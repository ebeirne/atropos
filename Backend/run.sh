#!/bin/sh
# Starts the Leaf API from any folder: sh Backend/run.sh (or ./run.sh inside Backend).
# uvicorn has to run inside Backend/ to find app.main, and --reload should only watch the backend.
cd "$(dirname "$0")" || exit 1
exec .venv/bin/python -m uvicorn app.main:app --reload --reload-dir app "$@"
