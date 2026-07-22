"""Email canonicalisation and disposable-domain screening for signup.

Two jobs, both aimed at "one person, many accounts":

1. ``canonical_email`` collapses the addresses that deliver to the same inbox
   but look distinct to a naive uniqueness check — Gmail dot-insertion and
   ``+tag`` sub-addressing. It is used ONLY for the duplicate check. The
   address we store and send to is the one the user typed, because
   ``me+trusthalal@gmail.com`` is a legitimate thing to want and the
   verification email has to actually arrive.

2. ``is_disposable_domain`` rejects the throwaway-inbox services that make
   bot signups free. This is the higher-value half — the bots we saw did not
   need Gmail tricks, they needed a temp inbox that could receive the
   verification link.

## What this deliberately is NOT

Not an allow-list, not an MX probe, not a reputation service. An allow-list
would lock out every self-hosted and small-business domain, which on a
platform built for restaurant owners is exactly the wrong population to
exclude. The disposable list is a denylist of known throwaway providers; it
will miss new ones and is meant to be appended to, not to be complete.

The canonical form is NOT stored as the delivery address and NOT treated as
"the real email". It is a dedup key. Storing it as the address would break
delivery to a plus-tagged inbox the user chose on purpose.
"""
from __future__ import annotations

# Providers that ignore dots in the local part. Only these get dots stripped —
# doing it universally would wrongly merge ``a.b@example.com`` and
# ``ab@example.com`` at a provider that treats them as different mailboxes.
_DOT_INSENSITIVE = frozenset({"gmail.com", "googlemail.com"})

# Providers where "+tag" routes to the base inbox. Most major providers honour
# this; listing them explicitly avoids stripping "+" at a provider that treats
# it as a literal local-part character.
_PLUS_ALIASING = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "icloud.com",
        "me.com",
        "fastmail.com",
        "proton.me",
        "protonmail.com",
    }
)

# Known disposable / throwaway inbox providers. NOT exhaustive by design —
# append as new ones show up in the signup logs. Kept as a frozenset for O(1)
# lookup; a few hundred entries is fine in memory.
_DISPOSABLE_DOMAINS = frozenset(
    {
        "mailinator.com",
        "guerrillamail.com",
        "guerrillamail.info",
        "sharklasers.com",
        "grr.la",
        "10minutemail.com",
        "10minutemail.net",
        "temp-mail.org",
        "tempmail.com",
        "tempmailo.com",
        "throwawaymail.com",
        "yopmail.com",
        "yopmail.net",
        "getnada.com",
        "nada.email",
        "dispostable.com",
        "trashmail.com",
        "trashmail.de",
        "mailcatch.com",
        "maildrop.cc",
        "mohmal.com",
        "fakeinbox.com",
        "spamgourmet.com",
        "mintemail.com",
        "emailondeck.com",
        "moakt.com",
        "tempr.email",
        "burnermail.io",
        "mailnesia.com",
        "inboxkitten.com",
        "tmpmail.org",
        "tmpmail.net",
        "harakirimail.com",
        "33mail.com",
        "anonaddy.me",
        "mailsac.com",
        "cs.email",
        "byom.de",
        "spam4.me",
        "vomoto.com",
    }
)


def _split(email: str) -> tuple[str, str]:
    """``('local', 'domain.com')`` from a raw address, lower-cased.

    No validation — Pydantic ``EmailStr`` has already guaranteed exactly one
    ``@`` and a plausible shape by the time this runs. If somehow it hasn't,
    a missing ``@`` yields ``('', '')`` and the callers treat that as "not
    disposable / canonical is the input", which fails open rather than 500.
    """
    raw = email.strip().lower()
    if "@" not in raw:
        return "", ""
    local, _, domain = raw.rpartition("@")
    return local, domain


def domain_of(email: str) -> str:
    return _split(email)[1]


def is_disposable_domain(email: str) -> bool:
    """True if the address is at a known throwaway provider."""
    return domain_of(email) in _DISPOSABLE_DOMAINS


def canonical_email(email: str) -> str:
    """A dedup key: the form that reaches the same inbox.

    ``M.E+tag@GMail.com`` and ``me@gmail.com`` both canonicalise to
    ``me@gmail.com``. For providers we don't special-case, this is just the
    trimmed, lower-cased address — so it never MERGES accounts we're unsure
    about, it only merges the ones we know route together.
    """
    local, domain = _split(email)
    if not domain:
        return email.strip().lower()

    # "+tag" first, so "a.b+x@gmail" loses the tag before dot handling.
    if domain in _PLUS_ALIASING and "+" in local:
        local = local.split("+", 1)[0]

    if domain in _DOT_INSENSITIVE:
        local = local.replace(".", "")

    # A provider can rename its domain (googlemail -> gmail); collapse the
    # alias so the canonical is stable across both spellings.
    if domain == "googlemail.com":
        domain = "gmail.com"

    return f"{local}@{domain}"
