"""Verifier program — Phase 8 of the halal-trust v2 rebuild (PENDING).

Models + schemas + enums for community moderators ("verifiers") who
do field visits. They sit alongside consumer disputes in the trust
mechanic: verifiers' site visits upgrade a halal claim's
``validation_tier`` to ``TRUST_HALAL_VERIFIED``.

Like ``app.modules.disputes``, this is a model-only module today.
The router / repo / service surfaces (verifier application + visit
submission + admin review of verifier applications) land in Phase 8.
"""
