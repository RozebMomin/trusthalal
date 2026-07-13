import os

# Local Postgres holding the job queue (NOT the production DB).
OPS_JOBS_DATABASE_URL = os.environ.get(
    "OPS_JOBS_DATABASE_URL",
    "postgresql+psycopg://ops:ops@localhost:5432/ops",
)

# Default seconds to sleep between Google resync calls (rate limiting).
THROTTLE_SECONDS = float(os.environ.get("OPS_THROTTLE_SECONDS", "0.5"))
