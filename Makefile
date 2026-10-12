# The local database from docker-compose.yml, whatever DATABASE_URL your shell or backend/.env
# has, so setup never touches another database. `make dev DATABASE_URL=...` overrides it.
DATABASE_URL := postgresql://postgres:hostelview@localhost:54329/hostelview
export DATABASE_URL

.PHONY: setup dev backend frontend check

## From a fresh clone: dependencies, database and schema.
setup:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt
	cd frontend && npm ci
	docker compose up -d --wait db
	cd backend && .venv/bin/python -m app.db migrate

## API on :8000 and web app on :3000.
dev:
	$(MAKE) -j2 backend frontend

backend:
	cd backend && .venv/bin/uvicorn app.api:app --reload --port 8000

frontend:
	cd frontend && npm run dev

## Type check, lint and build.
check:
	cd frontend && npm run typecheck && npm run lint && npm run build
	cd backend && .venv/bin/python -m compileall -q app
