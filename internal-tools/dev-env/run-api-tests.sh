#!/usr/bin/env bash
#
# Run the API test suite. Arguments pass straight through to pytest:
#
#   ./run-api-tests.sh                                    # everything
#   ./run-api-tests.sh tests/test_auth_email_verification.py
#   ./run-api-tests.sh -k verify -x                       # match + stop on first failure
#   ./run-api-tests.sh --lf                               # last failed
#
# Assumes setup-test-env.sh has been run at least once. It does one cheap
# liveness check on the database rather than repeating the whole setup —
# the common case is "I ran setup this morning, now I just want the tests",
# and paying 20 seconds of docker/poetry checks for that is how a test
# command stops getting used.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
API_DIR="${REPO_ROOT}/api"

DB_CONTAINER="trusthalal-db"
DB_USER="${TEST_DB_USER:-trusthalal}"

BOLD=$'\033[1m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'

if ! docker info >/dev/null 2>&1; then
  printf "\n  ${RED}Docker isn't running.${RESET} Start Docker Desktop, then re-run.\n\n" >&2
  exit 1
fi

if ! docker exec "${DB_CONTAINER}" pg_isready -U "${DB_USER}" -d trusthalal >/dev/null 2>&1; then
  printf "\n  ${YELLOW}The database isn't up.${RESET} Running setup first…\n" >&2
  "${SCRIPT_DIR}/setup-test-env.sh"
fi

cd "${API_DIR}"

# -v because a bare dot-per-test tells you nothing when you're waiting on a
# specific case. Callers can override by passing their own -q.
if [ "$#" -eq 0 ]; then
  printf "\n${BOLD}Running the full API suite…${RESET}\n\n"
  exec poetry run pytest -v
else
  printf "\n${BOLD}Running: pytest %s${RESET}\n\n" "$*"
  exec poetry run pytest -v "$@"
fi
