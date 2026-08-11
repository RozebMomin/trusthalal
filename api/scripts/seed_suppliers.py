"""Seed the supplier registry from the public-info JSON.

    poetry run python -m scripts.seed_suppliers            # load
    poetry run python -m scripts.seed_suppliers --dry-run  # parse + rollback

Every row lands at ``LISTED`` (public info only, cited in the JSON's
``source_url``) — this loader never promotes a tier. Promotion above LISTED
happens via the verification workflow (a document on file / traced audit),
not here. Idempotent on ``slug`` (+ meat_type/product_name for lines), so
re-running upserts rather than duplicates.

Source of truth for the data: scripts/seed_data/suppliers_seed.json, extracted
from docs/2026-08-11-supplier-seed-registry.md. See that doc + the research
playbook (docs/halal-supplier-research-playbook.md) before extending it.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.db.models  # noqa: F401  — register every model on Base.metadata
from app.db.session import SessionLocal
from app.modules.suppliers.enums import SupplierEventType
from app.modules.suppliers.models import Supplier, SupplierEvent, SupplierProduct

SEED_PATH = Path(__file__).parent / "seed_data" / "suppliers_seed.json"


def load_suppliers(db: Session, data: dict, *, dry_run: bool = False) -> dict[str, int]:
    """Upsert suppliers + product lines. Returns counts."""
    created = updated = lines = 0

    for s in data["suppliers"]:
        supplier = db.execute(
            select(Supplier).where(Supplier.slug == s["slug"])
        ).scalar_one_or_none()

        if supplier is None:
            supplier = Supplier(
                name=s["name"],
                slug=s["slug"],
                aliases=s.get("aliases") or [],
                website_url=s.get("website_url"),
                country_code=s.get("country_code"),
                region=s.get("region"),
                city=s.get("city"),
                verification_tier=s.get("verification_tier", "LISTED"),
                certifying_body_name=s.get("certifying_body_name"),
                notes=s.get("notes"),
            )
            db.add(supplier)
            db.flush()  # need supplier.id for products + the event
            db.add(
                SupplierEvent(
                    supplier_id=supplier.id,
                    event_type=SupplierEventType.LISTED.value,
                    description="Seeded from the public-info registry (LISTED).",
                )
            )
            created += 1
        else:
            supplier.name = s["name"]
            supplier.aliases = s.get("aliases") or []
            supplier.website_url = s.get("website_url")
            supplier.country_code = s.get("country_code")
            supplier.region = s.get("region")
            supplier.city = s.get("city")
            supplier.verification_tier = s.get("verification_tier", "LISTED")
            supplier.certifying_body_name = s.get("certifying_body_name")
            supplier.notes = s.get("notes")
            updated += 1

        for p in s["products"]:
            product = db.execute(
                select(SupplierProduct).where(
                    SupplierProduct.supplier_id == supplier.id,
                    SupplierProduct.meat_type == p["meat_type"],
                    SupplierProduct.product_name == p["product_name"],
                )
            ).scalar_one_or_none()

            fields = dict(
                slaughter_method=p.get("slaughter_method", "NOT_DISCLOSED"),
                line_tier=p.get("line_tier", "LISTED"),
                stunning=p.get("stunning"),
                certifying_body_name=p.get("certifying_body_name"),
                certificate_number=p.get("certificate_number"),
                certificate_url=p.get("certificate_url"),
                certificate_expires_at=p.get("certificate_expires_at"),
                source_url=p.get("source_url"),
                notes=p.get("notes"),
            )

            if product is None:
                db.add(
                    SupplierProduct(
                        supplier_id=supplier.id,
                        meat_type=p["meat_type"],
                        product_name=p["product_name"],
                        **fields,
                    )
                )
            else:
                for key, value in fields.items():
                    setattr(product, key, value)
            lines += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return {"created": created, "updated": updated, "lines": lines}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed the supplier registry (all rows LISTED / public-info)."
    )
    parser.add_argument("--path", default=str(SEED_PATH), help="Path to the seed JSON.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and apply in a transaction, then roll back (no writes).",
    )
    args = parser.parse_args()

    data = json.loads(Path(args.path).read_text())

    db: Session = SessionLocal()
    try:
        counts = load_suppliers(db, data, dry_run=args.dry_run)
    finally:
        db.close()

    tag = " (dry-run, rolled back)" if args.dry_run else ""
    print(
        "suppliers: created {created}, updated {updated}; "
        "product lines upserted {lines}{tag}".format(tag=tag, **counts)
    )


if __name__ == "__main__":
    main()
