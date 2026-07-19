"""Unit tests for the Supabase storage client's error contract.

Only ``delete_object`` is covered, and only its 4xx handling — because that's
where a wrong call is expensive rather than just noisy. The orphan sweeper
retries every failed delete forever by design, so if "the object is already
gone" reads as a failure, a single missing key turns into a job that can never
finish and a queue that never drains.
"""
from __future__ import annotations

import httpx
import pytest

from app.core import storage as storage_mod
from app.core.storage import StorageError, SupabaseStorageClient

CLIENT = SupabaseStorageClient(
    base_url="https://example.supabase.co",
    service_role_key="service-role-key",
    bucket="place-photos",
)


def _patch_delete(monkeypatch, status: int, body: dict) -> dict:
    """Swap httpx.delete for one returning ``status``/``body``, recording the URL.

    The Response is built inside the fake so it can carry the real request —
    ``raise_for_status`` needs one to render its message.
    """
    seen: dict = {}

    def fake_delete(url, **kwargs):
        seen["url"] = url
        return httpx.Response(
            status, json=body, request=httpx.Request("DELETE", url)
        )

    monkeypatch.setattr(storage_mod.httpx, "delete", fake_delete)
    return seen


def test_delete_succeeds_normally(monkeypatch):
    seen = _patch_delete(monkeypatch, 200, {})
    CLIENT.delete_object("place-id/photo-id.jpg")
    assert seen["url"].endswith("/place-photos/place-id/photo-id.jpg")


@pytest.mark.parametrize("status", [400, 404])
def test_delete_treats_a_missing_object_as_success(monkeypatch, status):
    """Supabase answers a delete for a nonexistent key with a 400 whose body
    says "Object not found". The caller asked for the object to not exist and
    it doesn't — raising here would make the sweeper's retry loop unwinnable
    and make an interrupted drain unsafe to re-run."""
    _patch_delete(
        monkeypatch,
        status,
        {
            "statusCode": str(status),
            "error": "InvalidRequest",
            "message": "Object not found",
        },
    )
    CLIENT.delete_object("place-id/already-gone.jpg")  # does not raise


def test_delete_still_raises_on_other_client_errors(monkeypatch):
    """The tolerance is narrow on purpose. An unauthorized request is a real
    problem and must not be swallowed as "already gone" — that would mark
    objects purged while the bytes stayed."""
    _patch_delete(
        monkeypatch,
        403,
        {"statusCode": "403", "error": "Unauthorized", "message": "not allowed"},
    )
    with pytest.raises(StorageError):
        CLIENT.delete_object("place-id/photo-id.jpg")


def test_delete_raises_on_a_400_that_is_not_a_missing_object(monkeypatch):
    """A 400 alone isn't the signal — the message is. A malformed path also
    returns 400, and treating that as success would drop the row from the
    outbox with the object still sitting in the bucket."""
    _patch_delete(
        monkeypatch,
        400,
        {"statusCode": "400", "error": "InvalidRequest", "message": "Invalid key"},
    )
    with pytest.raises(StorageError):
        CLIENT.delete_object("place-id/../escape.jpg")


def test_delete_raises_on_transport_failure(monkeypatch):
    """A network failure has to stay retryable — it says nothing about
    whether the object is still there."""

    def boom(url, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(storage_mod.httpx, "delete", boom)
    with pytest.raises(StorageError):
        CLIENT.delete_object("place-id/photo-id.jpg")
