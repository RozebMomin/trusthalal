# dev-env — run the API tests locally

Two scripts. Run the first one once; run the second whenever you want tests.

## One-click (macOS Finder)

Double-click **`Setup Test Environment.command`**, then
**`Run API Tests.command`**. Both keep the Terminal window open so you can
read the output.

macOS Gatekeeper blocks `.command` files the first time you open one from a
downloaded or cloned repo. If you get *"cannot be opened because it is from
an unidentified developer"*: right-click → Open → Open. Once per file.

## From a terminal

```bash
./internal-tools/dev-env/setup-test-env.sh          # once, or after a volume wipe
./internal-tools/dev-env/run-api-tests.sh           # the whole suite

# arguments pass through to pytest
./internal-tools/dev-env/run-api-tests.sh tests/test_auth_email_verification.py
./internal-tools/dev-env/run-api-tests.sh -k verify -x
./internal-tools/dev-env/run-api-tests.sh --lf      # re-run last failures
```

## What setup does

1. Checks Docker is **running** (not just installed — that's the usual
   failure), Poetry is present, and Python is in the 3.11–3.12 range the API
   requires.
2. Starts the `postgis/postgis:16-3.4` container from `api/docker-compose.yml`.
3. Polls `pg_isready` until Postgres actually accepts connections. A cold
   volume runs `initdb` and can take 10+ seconds; without this wait the next
   step fails intermittently on fast machines.
4. Creates the `trusthalal_test` database if it's missing, and ensures the
   PostGIS extension exists.
5. `poetry install`.
6. `alembic upgrade head` against the test database.

Every step is idempotent. Re-running is the correct response to almost any
"it stopped working" situation.

## Notes

**No local `psql` needed.** All SQL runs inside the container via
`docker exec`. `make test-db` in `api/` does the same job but assumes a
Postgres client on the host, which plenty of machines don't have.

**Step 6 is technically redundant** — `tests/conftest.py` runs migrations
itself on the first test. It's here as a fail-fast: a broken migration then
surfaces during setup, on its own, instead of as a confusing collection
error thirty tests into a run.

**The test database is separate from your dev database.** Same container,
different database (`trusthalal_test` vs `trusthalal`). The suite wraps
every test in a transaction that gets rolled back, so it doesn't accumulate
data — but it does `TRUNCATE` all `app.*` tables at session start to clear
anything a previously crashed run left behind. Don't point
`TEST_DATABASE_URL` at anything you care about.

## Overrides

| Variable | Default |
|---|---|
| `TEST_DB_NAME` | `trusthalal_test` |
| `TEST_DB_USER` | `trusthalal` |
| `TEST_DATABASE_URL` | `postgresql+psycopg://trusthalal:trusthalal@localhost:5432/trusthalal_test` |

## Troubleshooting

**"Docker is installed but not running"** — open Docker Desktop and wait for
the whale icon to settle, then re-run.

**Poetry picks the wrong Python** — `cd api && poetry env use $(which python3.12)`,
then re-run setup.

**Port 5432 already in use** — you have another Postgres running locally.
Stop it, or point the suite elsewhere with `TEST_DATABASE_URL`.

**Tests pass individually but fail together** — usually leaked state. Wipe
and rebuild: `cd api && docker compose down -v`, then run setup again.
