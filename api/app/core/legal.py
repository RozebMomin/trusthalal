"""The one place that says which terms are current.

App Store Guideline 1.2 requires users of an app hosting user-generated
content to agree to terms. Displaying a notice at signup satisfies that; being
able to say *who* agreed to *what*, and *when*, is a separate problem, and
that is what this module underwrites.

## Why a version string and not a boolean

A boolean answers "has this person ever accepted terms", which stops being the
useful question the first time counsel revises the document. Storing the
version they accepted means a revision automatically re-prompts everyone,
without a migration and without anyone remembering to reset a flag.

Bumping ``TERMS_VERSION`` therefore re-prompts every user on their next
``/me``. That is the intended and only mechanism — do it when the change is
material enough that their previous agreement no longer covers it, and leave
it alone for typo fixes. The value is a date rather than a number so a
support conversation can be matched against the page's "Last updated" line
without a lookup table.
"""
from __future__ import annotations

#: Must match the "Last updated" date on trusthalal.org/terms.
#: apps/brand/src/app/terms/page.tsx is the document this refers to.
#:
#: 2026-07-21 — V2. Legal review: definitions, indemnity, DMCA process,
#: expanded warranty and liability disclaimers, owner representations, API
#: and automated-access terms, force majeure. Material, so the bump is
#: correct and everyone is asked again.
TERMS_VERSION = "2026-07-21"


def acceptance_required(accepted_version: str | None) -> bool:
    """Should this user be asked to accept the terms?

    NULL covers everyone who signed up before acceptance was recorded —
    which, when this shipped, was every existing account, including the
    people whose reviews and photos the content licence is meant to cover.
    They are the reason the prompt exists.
    """
    return accepted_version != TERMS_VERSION
