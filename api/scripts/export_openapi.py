"""Dump the FastAPI OpenAPI schema to disk.

Used as the contract source for trusthalal-admin's codegen. Regenerate
whenever public routes / request bodies / response models change, commit
the resulting openapi.json, and the admin repo's codegen step will pick
up the new shapes on its next run.

Usage:
    poetry run python -m scripts.export_openapi
    # or via the top-level Makefile:
    make export-openapi
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.main import app


def main() -> int:
    # Repo root = parent of /scripts
    out_path = Path(__file__).resolve().parent.parent / "openapi.json"

    schema = app.openapi()
    # Stable key order + newline at EOF so git diffs stay minimal.
    out_path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")

    rel = out_path.relative_to(Path.cwd()) if out_path.is_relative_to(Path.cwd()) else out_path
    print(f"Wrote OpenAPI schema -> {rel}  ({out_path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
