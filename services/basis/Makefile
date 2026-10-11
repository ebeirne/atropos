PY=.venv/bin/python
.PHONY: setup backfill dev backend frontend snapshot smoke demo
setup:
	uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt && cd frontend && npm install
backfill:
	$(PY) -m scripts.backfill
backend:
	.venv/bin/uvicorn backend.main:app --port 8000 --reload
frontend:
	cd frontend && npm run dev
dev:
	@trap 'kill 0' INT; (.venv/bin/uvicorn backend.main:app --port 8000 &) ; cd frontend && npm run dev
demo:
	@trap 'kill 0' INT; (DEMO_MODE=1 .venv/bin/uvicorn backend.main:app --port 8000 &) ; cd frontend && npm run dev
snapshot:
	$(PY) -m scripts.snapshot
smoke:
	$(PY) -m scripts.smoke
