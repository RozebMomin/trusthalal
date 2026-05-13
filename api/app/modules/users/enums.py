from enum import StrEnum

class UserRole(StrEnum):
    ADMIN = "ADMIN"
    OWNER = "OWNER"
    VERIFIER = "VERIFIER"
    CONSUMER = "CONSUMER"


class UserAccountState(StrEnum):
    """Derived account-onboarding state, surfaced on the admin user
    list so operators can tell at a glance whether someone is fully
    set up, sitting on a fresh invite, or stuck on an expired one.

    Computed at read time from ``User.password_hash``,
    ``User.is_active``, and the user's most recent ``InviteToken``
    row — there's no underlying column for it. Storing a column
    would require either a trigger or careful re-computation on
    every state-changing path; the read-time derivation is simple
    enough that the join cost is negligible at our scale.

    The four states are mutually exclusive:

    * ``ACTIVE`` — ``password_hash IS NOT NULL`` and
      ``is_active = true``. Normal signed-in user.
    * ``DEACTIVATED`` — ``password_hash IS NOT NULL`` and
      ``is_active = false``. Admin disabled them; row preserved
      for audit but the user can't sign in.
    * ``INVITE_PENDING`` — ``password_hash IS NULL`` and a live
      invite token exists (not consumed, not expired). The user
      was sent an invite link and hasn't opened it yet.
    * ``INVITE_EXPIRED`` — ``password_hash IS NULL`` and no live
      invite. Either the original invite expired or it was never
      issued; the user is stuck and needs a re-invite to onboard.
    """

    ACTIVE = "ACTIVE"
    DEACTIVATED = "DEACTIVATED"
    INVITE_PENDING = "INVITE_PENDING"
    INVITE_EXPIRED = "INVITE_EXPIRED"