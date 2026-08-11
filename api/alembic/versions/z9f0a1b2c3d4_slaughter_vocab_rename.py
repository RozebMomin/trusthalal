"""Rename slaughter vocabulary: ZABIHAH -> HAND_CUT, MACHINE -> MACHINE_CUT

Describes the observable method ("hand-slaughtered") instead of asserting a
contested status ("zabihah"), aligning the profile enum with the supplier
registry's canonical vocabulary. NOT_SERVED is unchanged.

Rewrites data in three places:
  1. The four per-meat columns on app.halal_profiles (drop CHECK, UPDATE,
     recreate CHECK with the new value set).
  2. meat_products[].slaughter_method inside app.halal_claims.structured_response
     (JSONB).
  3. meat_products[].slaughter_method inside
     app.verification_visits.structured_findings (JSONB).

Done now while the dataset is small — the JSONB rewrite only gets more expensive
as claims accumulate. Row-at-a-time in Python is fine at this volume and keeps
the transform identical to the app's own vocabulary.

Revision ID: z9f0a1b2c3d4
Revises: y8e9f0a1b2c3
Create Date: 2026-08-11
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z9f0a1b2c3d4"
down_revision: Union[str, None] = "y8e9f0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MEATS = ("chicken", "beef", "lamb", "goat")
_COLUMNS = tuple(f"{m}_slaughter" for m in _MEATS)
_JSONB = (
    ("halal_claims", "structured_response"),
    ("verification_visits", "structured_findings"),
)


def _check(values: tuple[str, ...], col: str) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{col} IN ({quoted})"


def _rewrite_columns(conn, mapping: dict[str, str], allowed: tuple[str, ...]) -> None:
    # Drop CHECKs so the interim UPDATE can't trip them, rewrite, recreate.
    for meat in _MEATS:
        op.drop_constraint(
            f"ck_halal_profile_{meat}_slaughter",
            "halal_profiles",
            schema="app",
            type_="check",
        )
    for col in _COLUMNS:
        for old, new in mapping.items():
            conn.execute(
                sa.text(
                    f"UPDATE app.halal_profiles SET {col} = :new WHERE {col} = :old"
                ),
                {"new": new, "old": old},
            )
    for meat in _MEATS:
        op.create_check_constraint(
            f"ck_halal_profile_{meat}_slaughter",
            "halal_profiles",
            _check(allowed, f"{meat}_slaughter"),
            schema="app",
        )


def _rewrite_jsonb(conn, mapping: dict[str, str]) -> int:
    total = 0
    for table, col in _JSONB:
        rows = conn.execute(
            sa.text(f"SELECT id, {col} FROM app.{table} WHERE {col} IS NOT NULL")
        ).fetchall()
        for row_id, data in rows:
            if not isinstance(data, dict):
                continue
            products = data.get("meat_products")
            if not isinstance(products, list):
                continue
            changed = False
            for entry in products:
                if isinstance(entry, dict) and entry.get("slaughter_method") in mapping:
                    entry["slaughter_method"] = mapping[entry["slaughter_method"]]
                    changed = True
            if changed:
                conn.execute(
                    sa.text(
                        f"UPDATE app.{table} SET {col} = (:val)::jsonb WHERE id = :id"
                    ),
                    {"val": json.dumps(data), "id": row_id},
                )
                total += 1
    return total


def upgrade() -> None:
    conn = op.get_bind()
    mapping = {"ZABIHAH": "HAND_CUT", "MACHINE": "MACHINE_CUT"}
    _rewrite_columns(conn, mapping, ("HAND_CUT", "MACHINE_CUT", "NOT_SERVED"))
    n = _rewrite_jsonb(conn, mapping)
    print(f"slaughter vocab rename: rewrote {n} JSONB row(s)")


def downgrade() -> None:
    conn = op.get_bind()
    mapping = {"HAND_CUT": "ZABIHAH", "MACHINE_CUT": "MACHINE"}
    _rewrite_columns(conn, mapping, ("ZABIHAH", "MACHINE", "NOT_SERVED"))
    _rewrite_jsonb(conn, mapping)
