"""Backward-compat shim for the slaughter-vocabulary rename.

The stored/canonical vocabulary is ``HAND_CUT`` / ``MACHINE_CUT`` /
``NOT_SERVED`` (see ``halal_profiles.enums.SlaughterMethod``). Mobile builds
that shipped before the rename — and any browser tab still running pre-rename
JS — only understand the legacy words ``ZABIHAH`` / ``MACHINE``, and they send
no version header we could key off to detect them (the installed client sends
only Authorization / Accept / Content-Type).

So the public place-read embeds default to the **legacy** vocabulary and only
emit the new words when the caller opts in with ``X-TH-Slaughter-Vocab: v2``.
Updated clients (the current web apps + the new mobile build) send that header;
old installed clients don't, and transparently keep receiving the words their
code already renders. A stale web tab running old JS likewise omits the header
and stays self-consistent. Remove this shim once the pre-rename mobile build is
below the supported floor.

Scope is deliberately the two consumer embeds (``PlaceDetail`` and the search
``PlaceSearchResult``) — the only surfaces the installed mobile base reads a
slaughter method from. The ``HalalProfileEmbed`` slaughter fields are typed as
plain ``str`` (not the enum), so translation is a straight value rewrite with
no schema fight. ``supplier_provenance`` is intentionally NOT rewritten: that
block always spoke ``HAND_CUT`` / ``MACHINE_CUT`` (the supplier vocabulary) and
old clients already render it as-is.
"""
from __future__ import annotations

from starlette.requests import Request

# Header an updated client sends to opt into the canonical (post-rename)
# vocabulary. Kept as a module constant so the tests and any future client
# reference one source of truth.
SLAUGHTER_VOCAB_HEADER = "X-TH-Slaughter-Vocab"
_MODERN_OPT_IN = "v2"

# Canonical -> legacy. NOT_SERVED is unchanged across the rename and so is
# absent here (a missing key is a pass-through).
_TO_LEGACY = {"HAND_CUT": "ZABIHAH", "MACHINE_CUT": "MACHINE"}


def wants_modern_slaughter_vocab(request: Request) -> bool:
    """True when the caller opted into the post-rename vocabulary.

    Absence of the header means "legacy": old installed clients can't send it,
    so the safe default is the vocabulary their code understands.
    """
    return (
        request.headers.get(SLAUGHTER_VOCAB_HEADER, "").strip().lower()
        == _MODERN_OPT_IN
    )


def _legacy(value):
    return _TO_LEGACY.get(value, value)


def apply_legacy_slaughter_vocab(embed) -> None:
    """Rewrite a ``HalalProfileEmbed``'s slaughter fields to the legacy vocab.

    Mutates in place. Safe to call with ``None`` (no profile on the place).
    Only the four self-attested per-meat columns and the per-product
    ``meat_products[].slaughter_method`` are rewritten; ``supplier_provenance``
    is left alone on purpose (see module docstring).
    """
    if embed is None:
        return
    for col in (
        "chicken_slaughter",
        "beef_slaughter",
        "lamb_slaughter",
        "goat_slaughter",
    ):
        setattr(embed, col, _legacy(getattr(embed, col)))
    for mp in embed.meat_products or []:
        mp.slaughter_method = _legacy(mp.slaughter_method)
