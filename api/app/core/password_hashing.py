"""Password hashing for the user table.

Thin wrapper around ``argon2-cffi``. Argon2id is the OWASP-recommended
default — tuned here per the OWASP 2023 guidance (time_cost=3,
memory_cost=65 536 KiB, parallelism=2). Those numbers are a balance
between "secure against offline attack" and "cheap enough that logging
in doesn't feel slow on commodity hardware."

Callers should use exactly two functions:

  * ``hash_password(plain)`` → stored hash string. Opaque — includes
    the algorithm, parameters, and salt inline, so a future parameter
    bump doesn't require a migration.
  * ``verify_password(plain, stored_hash)`` → bool. Constant-time
    comparison via argon2's native API. Returns False on any error
    (malformed hash, mismatched params, etc.) so the caller sees a
    clean boolean and doesn't have to catch the library's exceptions.

Rehash-on-verify: when argon2 flags the stored hash as "using
weaker-than-current parameters," ``needs_rehash`` is True. Callers
concerned with forward compatibility can check this and re-hash the
password transparently on login. We deliberately do NOT auto-rehash
here — that's a policy decision for the caller, and it requires
write access to the user row which the hasher shouldn't have.
"""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import (
    InvalidHash,
    VerificationError,
    VerifyMismatchError,
)


# Shared hasher instance: cheap to construct but there's no reason to
# recreate it per-call. Tuned per OWASP 2023. If you bump these values
# later, existing hashes keep verifying — argon2's self-describing
# format means the stored hash carries its own params.
_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65_536,  # KiB, i.e. 64 MB
    parallelism=2,
)


def hash_password(plain: str) -> str:
    """Argon2id hash of ``plain``. Opaque, includes salt + params."""
    return _hasher.hash(plain)


def verify_password(plain: str, stored_hash: str) -> bool:
    """Constant-time verify. Returns False on any error (no exceptions)."""
    try:
        _hasher.verify(stored_hash, plain)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False


def needs_rehash(stored_hash: str) -> bool:
    """Returns True if ``stored_hash`` was made with weaker params than
    the current config. Callers can use this to transparently re-hash
    a user's password on their next successful login.

    Returns False when the hash is malformed — no sense triggering a
    rehash dance for broken rows.
    """
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHash:
        return False
