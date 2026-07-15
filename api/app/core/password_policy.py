"""Shared password-strength policy for account creation and reset.

Single source of truth: applied to every schema where a user *sets* a
password — signup (web + mobile), invite set-password, and reset. Login is
deliberately exempt (we only verify existing passwords there, and old
accounts may predate this policy).

Policy: at least 10 characters, and a mix of an uppercase letter, a
lowercase letter, and a number. Symbols are allowed but not required — the
goal is a meaningful floor without pushing users toward "P@ssw0rd!"-style
predictability.
"""
from __future__ import annotations

import re
from typing import Annotated

from pydantic import AfterValidator, Field

PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 256

PASSWORD_POLICY_MESSAGE = (
    f"Password must be at least {PASSWORD_MIN_LENGTH} characters and include "
    "an uppercase letter, a lowercase letter, and a number."
)

_UPPER = re.compile(r"[A-Z]")
_LOWER = re.compile(r"[a-z]")
_DIGIT = re.compile(r"\d")


def validate_password_strength(value: str) -> str:
    """Raise ``ValueError`` (→ 422) with a friendly message if ``value``
    doesn't meet the policy. Returns the value unchanged when it passes."""
    if (
        len(value) < PASSWORD_MIN_LENGTH
        or not _UPPER.search(value)
        or not _LOWER.search(value)
        or not _DIGIT.search(value)
    ):
        raise ValueError(PASSWORD_POLICY_MESSAGE)
    return value


# Reusable field type for password-creation schemas. We keep only the
# max_length bound on the Field (so an over-long password is a clean 422 and
# never silently truncated) and let the validator own the min-length +
# composition rule, so every failure surfaces the same friendly message.
NewPassword = Annotated[
    str,
    Field(max_length=PASSWORD_MAX_LENGTH),
    AfterValidator(validate_password_strength),
]
