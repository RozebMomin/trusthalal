"""Integration tests for the mobile bearer-token auth surface.

POST /auth/mobile/* is the React Native app's auth path — same
credentials and user rows as the web's cookie login, different
transport (opaque access + refresh tokens; see
app/modules/auth/mobile_tokens.py for the design rationale).

Covers:
  * signup → 201, CONSUMER role forced, token envelope returned,
    access token immediately good for GET /me via Authorization header
  * login → same envelope; generic INVALID_CREDENTIALS on bad password
  * bearer works on an auth-required consumer surface (/me/favorites)
  * refresh rotation is single-use — the old refresh AND old access
    both die when a pair rotates
  * logout revokes the pair and is idempotent (204 twice)
  * a garbage bearer never falls back to any other auth path
"""
from __future__ import annotations

from app.core.password_hashing import hash_password


def _mobile_signup(api, email="amira@example.com"):
    resp = api.post(
        "/auth/mobile/signup",
        json={
            "email": email,
            "password": "S3cure-passphrase",
            "display_name": "Amira K",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth_headers(body):
    return {"Authorization": f"Bearer {body['access_token']}"}


# ---------------------------------------------------------------------------
# Signup
# ---------------------------------------------------------------------------
def test_mobile_signup_returns_tokens_and_consumer_role(api):
    body = _mobile_signup(api)

    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 3600
    assert body["access_token"].startswith("tht_ma_")
    assert body["refresh_token"].startswith("tht_mr_")
    assert body["user"]["role"] == "CONSUMER"
    assert body["user"]["display_name"] == "Amira K"

    # The access token is immediately usable — no second round trip.
    me = api.get("/me", headers=_auth_headers(body))
    assert me.status_code == 200, me.text
    assert me.json()["email"] == "amira@example.com"


def test_mobile_signup_duplicate_email_conflicts(api):
    _mobile_signup(api)
    resp = api.post(
        "/auth/mobile/signup",
        json={
            "email": "amira@example.com",
            "password": "Another-passphrase1",
            "display_name": "Impostor",
        },
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "EMAIL_TAKEN"


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
def test_mobile_login_happy_path(api, factories, db_session):
    user = factories.user(email="diner@example.com")
    user.password_hash = hash_password("correct-horse-battery")
    db_session.add(user)
    db_session.commit()

    resp = api.post(
        "/auth/mobile/login",
        json={"email": "diner@example.com", "password": "correct-horse-battery"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["id"] == str(user.id)

    me = api.get("/me", headers=_auth_headers(body))
    assert me.status_code == 200


def test_mobile_login_bad_password_is_generic(api, factories, db_session):
    user = factories.user(email="diner@example.com")
    user.password_hash = hash_password("correct-horse-battery")
    db_session.add(user)
    db_session.commit()

    resp = api.post(
        "/auth/mobile/login",
        json={"email": "diner@example.com", "password": "wrong"},
    )
    assert resp.status_code == 401, resp.text
    assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"


# ---------------------------------------------------------------------------
# Bearer on real consumer surfaces
# ---------------------------------------------------------------------------
def test_bearer_authenticates_favorites(api, factories, db_session):
    body = _mobile_signup(api)
    place = factories.place(name="Karachi Grill House")
    db_session.commit()

    save = api.post(
        f"/me/favorites/{place.id}",
        headers=_auth_headers(body),
    )
    assert save.status_code in (200, 201), save.text

    listing = api.get("/me/favorites", headers=_auth_headers(body))
    assert listing.status_code == 200
    assert any(
        f["place"]["id"] == str(place.id) if "place" in f else f.get("place_id") == str(place.id)
        for f in listing.json()
    )


def test_garbage_bearer_is_401_not_fallback(api):
    resp = api.get(
        "/me", headers={"Authorization": "Bearer tht_ma_" + "0" * 64}
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Refresh rotation
# ---------------------------------------------------------------------------
def test_refresh_rotates_and_old_pair_dies(api):
    first = _mobile_signup(api)

    rotated = api.post(
        "/auth/mobile/refresh",
        json={"refresh_token": first["refresh_token"]},
    )
    assert rotated.status_code == 200, rotated.text
    second = rotated.json()
    assert second["access_token"] != first["access_token"]
    assert second["refresh_token"] != first["refresh_token"]

    # New access works…
    assert api.get("/me", headers=_auth_headers(second)).status_code == 200
    # …old access is revoked with the pair…
    assert api.get("/me", headers=_auth_headers(first)).status_code == 401
    # …and the old refresh token is single-use.
    replay = api.post(
        "/auth/mobile/refresh",
        json={"refresh_token": first["refresh_token"]},
    )
    assert replay.status_code == 401, replay.text
    assert replay.json()["error"]["code"] == "INVALID_REFRESH_TOKEN"


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------
def test_logout_revokes_pair_and_is_idempotent(api):
    body = _mobile_signup(api)

    out = api.post(
        "/auth/mobile/logout", json={"refresh_token": body["refresh_token"]}
    )
    assert out.status_code == 204, out.text

    # Access token dead, refresh dead.
    assert api.get("/me", headers=_auth_headers(body)).status_code == 401
    assert (
        api.post(
            "/auth/mobile/refresh",
            json={"refresh_token": body["refresh_token"]},
        ).status_code
        == 401
    )

    # Logout again with the same (now-revoked) token: still 204.
    again = api.post(
        "/auth/mobile/logout", json={"refresh_token": body["refresh_token"]}
    )
    assert again.status_code == 204
