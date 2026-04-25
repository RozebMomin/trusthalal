"""Integration tests for ``PATCH /admin/users/{user_id}``.

Focus: the self-demotion / self-deactivation guards. The HTTP layer wires
the current admin's id through to ``admin_patch_user`` as ``actor_user_id``,
and the repo refuses role flips or deactivation when the actor and the
target are the same row.

Belt-and-suspenders on top of the admin panel hiding: the dialog hides the
role dropdown + active toggle when editing yourself, but a stale cache or
direct API call from devtools can still land the request at the server.
These tests pin the server-side contract so a future repo refactor
(parameter rename, repo split, etc.) can't quietly drop the guard.

Covered transitions
-------------------
- Self role PATCH to SAME role       → 200 (no-op allowed)
- Self role PATCH to DIFFERENT role  → 403 SELF_ROLE_CHANGE_FORBIDDEN
- Self is_active PATCH to SAME value → 200 (no-op allowed)
- Self is_active=false when true     → 403 SELF_DEACTIVATION_FORBIDDEN
- Self display_name PATCH            → 200 (never dangerous)
- Admin PATCHing ANOTHER admin       → 200 for both role + is_active
  (guard must scope to actor == target, not "anyone admin → anyone admin")
"""
from __future__ import annotations


# ---------------------------------------------------------------------------
# Self role changes
# ---------------------------------------------------------------------------
def test_self_role_patch_to_same_role_is_noop_and_allowed(api, factories):
    """Re-asserting the current role is a no-op, not a footgun.

    A PATCH that sends ``role: ADMIN`` for an already-admin actor is
    harmless — it doesn't flip anything and doesn't lock them out. The
    guard only fires on an actual state change, so idempotent PATCHes
    from clients that resend the full form state don't get rejected.
    """
    admin = factories.admin()

    resp = api.as_user(admin).patch(
        f"/admin/users/{admin.id}",
        json={"role": "ADMIN"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "ADMIN"


def test_self_role_patch_to_different_role_is_forbidden(api, factories):
    """The core self-demotion guard.

    An admin demoting themselves to CONSUMER (or anything non-ADMIN)
    would lose admin access the moment the next request hits
    ``require_roles``. The server refuses explicitly so the only path
    back is another admin's intervention — not a DB edit.
    """
    admin = factories.admin()

    resp = api.as_user(admin).patch(
        f"/admin/users/{admin.id}",
        json={"role": "CONSUMER"},
    )

    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "SELF_ROLE_CHANGE_FORBIDDEN"


# ---------------------------------------------------------------------------
# Self active toggles
# ---------------------------------------------------------------------------
def test_self_is_active_patch_to_same_value_is_noop_and_allowed(api, factories):
    """Re-asserting is_active=true for an already-active admin is a no-op.

    Mirrors the role-same-value case: only an actual flip trips the guard.
    """
    admin = factories.admin()

    resp = api.as_user(admin).patch(
        f"/admin/users/{admin.id}",
        json={"is_active": True},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is True


def test_self_deactivation_is_forbidden(api, factories):
    """Deactivating yourself would end your session on the next request
    (``resolve_session`` filters on ``users.is_active=true``). The server
    refuses explicitly so an admin can't lock themselves out from the
    detail page's quick-toggle button.
    """
    admin = factories.admin()

    resp = api.as_user(admin).patch(
        f"/admin/users/{admin.id}",
        json={"is_active": False},
    )

    assert resp.status_code == 403, resp.text
    assert resp.json()["error"]["code"] == "SELF_DEACTIVATION_FORBIDDEN"


# ---------------------------------------------------------------------------
# Self display_name is always allowed
# ---------------------------------------------------------------------------
def test_self_display_name_patch_is_allowed(api, factories):
    """Nothing about renaming yourself locks you out. The guard stays
    scoped to role + is_active; display_name self-edits must keep working
    so admins can fix typos or update their own profile name.
    """
    admin = factories.admin(display_name="Original")

    resp = api.as_user(admin).patch(
        f"/admin/users/{admin.id}",
        json={"display_name": "Renamed Admin"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["display_name"] == "Renamed Admin"


# ---------------------------------------------------------------------------
# Cross-admin edits must still work — guard only fires on self
# ---------------------------------------------------------------------------
def test_admin_can_demote_a_different_admin(api, factories):
    """Guard scope: ``actor_user_id == user.id``, not "admin → admin".

    An admin demoting a DIFFERENT admin is the explicit escape hatch for
    the self-guard (when an admin really needs their role changed, they
    ask another admin to do it). If this ever starts 403-ing we've
    broken the only path back from self-demotion.
    """
    actor = factories.admin()
    other_admin = factories.admin()

    resp = api.as_user(actor).patch(
        f"/admin/users/{other_admin.id}",
        json={"role": "CONSUMER"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "CONSUMER"


def test_admin_can_deactivate_a_different_admin(api, factories):
    """Same escape-hatch logic for is_active. Cross-admin deactivation
    is the recovery path for a compromised account — must stay 200.
    """
    actor = factories.admin()
    other_admin = factories.admin()

    resp = api.as_user(actor).patch(
        f"/admin/users/{other_admin.id}",
        json={"is_active": False},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False
