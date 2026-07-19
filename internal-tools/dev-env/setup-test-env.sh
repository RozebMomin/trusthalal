#!/usr/bin/env bash
#
# One-shot setup for running the API test suite locally.
#
# Idempotent by design — safe to re-run any time, and the right thing to run
# after a `docker volume rm`, a fresh clone, or a dependency bump. Every step
# checks whether it's already done before doing it.
#
# What it does:
#   1. Verifies Docker, Poetry, and a supported Python are present.
#   2. Starts the Postgres/PostGIS container from api/docker-compose.yml.
#   3. Waits for it to actually accept connections (not just "started").
#   4. Creates the trusthalal_test database if missing.
#   5. Installs Python dependencies via Poetry.
#   6. Applies Alembic migrations to the test DB and reports the head.
#
# It does NOT run the tests — that's run-api-tests.sh, so you can re-run the
# suite without paying for setup every time.

set -euo pipefail

# Resolve the repo root from this script's own location, so it works no
# matter where it's invoked from (Finder double-click starts in $HOME).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
API_DIR="${REPO_ROOT}/api"

TEST_DB_NAME="${TEST_DB_NAME:-trusthalal_test}"
DB_USER="${TEST_DB_USER:-trusthalal}"
DB_CONTAINER="trusthalal-db"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'

step() { printf "\n${BOLD}▸ %s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${RESET} %s\n" "$1"; }
die()  { printf "\n  ${RED}✗ %s${RESET}\n\n" "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
step "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die \
  "Docker isn't installed. Get Docker Desktop: https://docs.docker.com/desktop/"

# `docker info` is the honest check — the CLI can exist while the daemon is
# not running, which is the single most common failure on a fresh laptop.
docker info >/dev/null 2>&1 || die \
  "Docker is installed but not running. Start Docker Desktop and re-run this."
ok "Docker is running"

# Compose v2 ships as a docker subcommand; v1 is a separate binary. Support
# both rather than assuming.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "Neither 'docker compose' nor 'docker-compose' is available."
fi
ok "Compose available (${COMPOSE})"

command -v poetry >/dev/null 2>&1 || die \
  "Poetry isn't installed. Install it: curl -sSL https://install.python-poetry.org | python3 -"
ok "Poetry $(poetry --version 2>/dev/null | sed 's/Poetry (version \(.*\))/\1/')"

# pyproject requires >=3.11,<3.13. Poetry will complain later anyway, but a
# clear message now beats a resolver error twenty lines deep.
PY_OK=$(python3 -c 'import sys; print(1 if (3,11) <= sys.version_info[:2] < (3,13) else 0)' 2>/dev/null || echo 0)
if [ "${PY_OK}" != "1" ]; then
  warn "python3 is $(python3 -V 2>&1 | cut -d' ' -f2); the API wants >=3.11,<3.13."
  warn "If Poetry picks the wrong one: poetry env use \$(which python3.12)"
else
  ok "Python $(python3 -V 2>&1 | cut -d' ' -f2)"
fi

# ---------------------------------------------------------------------------
# 2. Database container
# ---------------------------------------------------------------------------
step "Starting Postgres (PostGIS)"

cd "${API_DIR}"
${COMPOSE} up -d db >/dev/null
ok "Container up"

# ---------------------------------------------------------------------------
# 3. Wait for readiness
# ---------------------------------------------------------------------------
# "Container running" and "Postgres accepting connections" are different
# things — on a cold volume the first boot runs initdb and can take 10s+.
# Polling pg_isready is the difference between this script working and it
# failing intermittently on fast machines.
step "Waiting for Postgres to accept connections"

READY=0
for i in $(seq 1 60); do
  if docker exec "${DB_CONTAINER}" pg_isready -U "${DB_USER}" -d trusthalal >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
  [ $((i % 10)) -eq 0 ] && printf "  ${DIM}still waiting (%ss)…${RESET}\n" "$i"
done
[ "${READY}" = "1" ] || die "Postgres didn't become ready in 60s. Check: ${COMPOSE} logs db"
ok "Accepting connections"

# ---------------------------------------------------------------------------
# 4. Test database
# ---------------------------------------------------------------------------
# Run psql *inside* the container rather than requiring a local psql client.
# The Makefile's test-db target assumes psql on the host; plenty of machines
# have Docker but no Postgres client tools.
step "Ensuring the ${TEST_DB_NAME} database exists"

EXISTS=$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB_NAME}'" 2>/dev/null || true)

if [ "${EXISTS}" = "1" ]; then
  ok "${TEST_DB_NAME} already exists"
else
  docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d postgres \
    -c "CREATE DATABASE ${TEST_DB_NAME} OWNER ${DB_USER};" >/dev/null
  ok "Created ${TEST_DB_NAME}"
fi

# The first migration needs PostGIS. conftest.py creates the extension too,
# but doing it here means a failure surfaces during setup with a clear
# message rather than mid-test-run as a confusing SQL error.
docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TEST_DB_NAME}" \
  -c "CREATE EXTENSION IF NOT EXISTS postgis;" >/dev/null
ok "PostGIS extension present"

# ---------------------------------------------------------------------------
# 5. Python dependencies
# ---------------------------------------------------------------------------
step "Installing Python dependencies"
poetry install --no-interaction
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# 6. Migrations
# ---------------------------------------------------------------------------
# conftest.py runs `alembic upgrade head` itself on the first test, so this
# is strictly a fail-fast: a broken migration shows up here, in isolation,
# instead of as a mysterious collection error.
step "Applying migrations to ${TEST_DB_NAME}"

TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql+psycopg://${DB_USER}:trusthalal@localhost:5432/${TEST_DB_NAME}}"
DATABASE_URL="${TEST_DATABASE_URL}" poetry run alembic upgrade head
HEAD_REV="$(DATABASE_URL="${TEST_DATABASE_URL}" poetry run alembic current 2>/dev/null | tail -1)"
ok "At ${HEAD_REV:-head}"

printf "\n${GREEN}${BOLD}Test environment ready.${RESET}\n\n"
printf "  Run the suite:      ${BOLD}./internal-tools/dev-env/run-api-tests.sh${RESET}\n"
printf "  One file:           ${BOLD}./internal-tools/dev-env/run-api-tests.sh tests/test_auth_email_verification.py${RESET}\n"
printf "  Stop the database:  ${BOLD}cd api && ${COMPOSE} down${RESET}\n\n"
