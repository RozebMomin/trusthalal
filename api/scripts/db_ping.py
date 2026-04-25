"""Quick connectivity test for the local Postgres/PostGIS instance.

Run from repo root:
  poetry run python scripts/db_ping.py

If you run it from another directory, it will still work because we add the
repo root to sys.path.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure repo root is on the import path so `import app...` works reliably.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from sqlalchemy import create_engine, text

from app.core.config import settings


def main() -> None:
    if not settings.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")

    engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
    with engine.connect() as conn:
        db = conn.execute(text("select current_database()")) .scalar_one()
        version = conn.execute(text("select version()")) .scalar_one()
        postgis = conn.execute(text("select PostGIS_Version()")) .scalar_one()

    print("DB:", db)
    print("Postgres:", version.splitlines()[0])
    print("PostGIS:", postgis)


if __name__ == "__main__":
    main()