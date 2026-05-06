"""Consumer disputes — Phase 7 of the halal-trust v2 rebuild (PENDING).

Models, enums, and Pydantic schemas live here so the cross-module
FKs on ``halal_claims.triggered_by_dispute_id`` and
``halal_profile_events.related_dispute_id`` resolve at import time.
The router / repo / service layers land in Phase 7.

A new contributor reading this won't find an HTTP surface for
disputes yet — that's expected, not a bug. Until Phase 7 ships,
``ConsumerDispute`` rows are only writable through Alembic test
fixtures or direct SQL.
"""
