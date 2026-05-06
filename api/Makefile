# trusthalal-api -- common developer tasks.
#
# `make help` lists available targets. Keep recipes idempotent and
# cheap to run; nothing here should touch prod.

.DEFAULT_GOAL := help

.PHONY: help dev test test-db seed seed-users reset-db export-openapi migrate

help:  ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev:  ## Run the API in reload mode on :8000
	poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

test:  ## Run pytest
	poetry run pytest -v

# Idempotent — safe to re-run after a docker volume wipe. Creates the
# test database if it's missing so conftest.py can apply migrations on
# first test invocation. TEST_DATABASE_URL overrides the default, same
# as the test harness's own resolution (see tests/conftest.py).
TEST_DB_USER ?= trusthalal
TEST_DB_PASSWORD ?= trusthalal
TEST_DB_HOST ?= localhost
TEST_DB_PORT ?= 5432
TEST_DB_NAME ?= trusthalal_test

test-db:  ## Create the test database if it doesn't exist (idempotent)
	@psql "postgresql://$(TEST_DB_USER):$(TEST_DB_PASSWORD)@$(TEST_DB_HOST):$(TEST_DB_PORT)/postgres" \
		-tAc "SELECT 1 FROM pg_database WHERE datname = '$(TEST_DB_NAME)'" | grep -q 1 \
		&& echo "$(TEST_DB_NAME) already exists." \
		|| ( psql "postgresql://$(TEST_DB_USER):$(TEST_DB_PASSWORD)@$(TEST_DB_HOST):$(TEST_DB_PORT)/postgres" \
				-c "CREATE DATABASE $(TEST_DB_NAME) OWNER $(TEST_DB_USER);" \
			&& echo "Created $(TEST_DB_NAME)." )

seed:  ## Seed the dev database with the full fixture (idempotent)
	poetry run python -m scripts.seed_dev

seed-users:  ## Seed only the dev users (admin + others) — empty catalog
	poetry run python -m scripts.seed_dev --users-only

reset-db:  ## Wipe app schema clean and seed a single admin user (local-only by default)
	poetry run python -m scripts.reset_db

migrate:  ## Apply alembic migrations to head
	poetry run alembic upgrade head

export-openapi:  ## Regenerate openapi.json from the FastAPI app
	poetry run python -m scripts.export_openapi
