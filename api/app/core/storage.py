"""Object storage abstraction for owner-uploaded evidence.

Why not just import an SDK?
---------------------------
Supabase ships ``supabase-py`` and ``storage3``, but pulling those in
adds dozens of transitive dependencies for what amounts to three HTTP
calls (upload, sign, delete). We already use ``httpx`` for the Google
Places client; reusing it here keeps the dependency surface small and
the test pattern (inject a fake ``StorageClient`` into the upload
service) consistent.

What this module owns
---------------------
* ``StorageClient`` — Protocol describing the four operations callers
  need: ``upload_bytes``, ``signed_url``, ``delete_object``, and a
  per-instance bucket name. Tests inject in-memory fakes; production
  uses ``SupabaseStorageClient``.
* ``SupabaseStorageClient`` — concrete implementation. Reads
  ``SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY`` +
  ``SUPABASE_STORAGE_BUCKET`` from settings. Service-role key bypasses
  Row-Level Security, which is what we want for server-side writes —
  RLS gates the public anon key on the bucket so direct browser
  uploads aren't possible.
* ``StorageError`` — uniform exception so callers don't have to know
  about httpx error types or Supabase-specific status codes.
* ``get_storage_client()`` — factory used by the FastAPI dependency
  injection. Returns a singleton in production; tests override the
  dependency to inject a fake.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote as urlquote

import httpx

from app.core.config import settings


class StorageError(Exception):
    """Raised when an object storage operation fails for any reason.

    Wraps the underlying httpx / status-code error so callers (the
    upload route, etc.) can render a single clean failure mode
    instead of branching on transport-vs-application errors.
    """


class StorageClient(Protocol):
    """The operations the rest of the app needs from object storage.

    Tests inject in-memory implementations; production uses
    ``SupabaseStorageClient``. Keeping this lean — no presigned-upload
    yet, no metadata read, no list — until those are actually needed.
    """

    @property
    def bucket(self) -> str: ...

    def upload_bytes(
        self,
        path: str,
        data: bytes,
        *,
        content_type: str,
    ) -> None: ...

    def signed_url(self, path: str, *, expires_in_seconds: int) -> str: ...

    def delete_object(self, path: str) -> None: ...


# ---------------------------------------------------------------------------
# Supabase implementation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SupabaseStorageClient:
    """REST-API client for Supabase Storage.

    Three operations:

      * ``upload_bytes`` —  POST /storage/v1/object/{bucket}/{path}
                            with the file body.
      * ``signed_url``   —  POST /storage/v1/object/sign/{bucket}/{path}
                            returning a short-lived URL the admin
                            panel can hand to a download click.
      * ``delete_object`` — DELETE /storage/v1/object/{bucket}/{path}.
                            Used by the cleanup-orphans path; not
                            wired into the live request flow yet.

    The service-role key bypasses RLS, so the bucket itself can stay
    locked down — public reads/writes are off, only this server-side
    client touches it.
    """

    base_url: str
    service_role_key: str
    bucket: str
    timeout_s: float = 30.0

    def _api_url(self, action: str, path: str) -> str:
        # Path components are user-controlled (request_id + filename)
        # so escape every segment. Slashes in ``path`` are intentional
        # (folder structure inside the bucket) and stay unescaped via
        # ``safe="/"``.
        safe_path = urlquote(path, safe="/")
        return (
            f"{self.base_url.rstrip('/')}/storage/v1/object/"
            f"{action}{self.bucket}/{safe_path}"
        )

    def _auth_headers(self) -> dict[str, str]:
        # Both Authorization and apikey are accepted; sending both is
        # idiomatic for the Supabase REST API and matches how the JS
        # SDK does it under the hood.
        return {
            "Authorization": f"Bearer {self.service_role_key}",
            "apikey": self.service_role_key,
        }

    def upload_bytes(
        self,
        path: str,
        data: bytes,
        *,
        content_type: str,
    ) -> None:
        # ``upsert`` defaults to false on Supabase; explicitly setting
        # it here documents the contract: this method ASSUMES the
        # path is unique (UUID-named files), and a collision should
        # surface as an error rather than silently overwrite.
        headers = {
            **self._auth_headers(),
            "Content-Type": content_type,
            "x-upsert": "false",
        }
        try:
            resp = httpx.post(
                self._api_url("", path),
                content=data,
                headers=headers,
                timeout=self.timeout_s,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise StorageError(f"Object storage upload failed: {exc}") from exc

    def signed_url(self, path: str, *, expires_in_seconds: int) -> str:
        try:
            resp = httpx.post(
                self._api_url("sign/", path),
                json={"expiresIn": expires_in_seconds},
                headers={
                    **self._auth_headers(),
                    "Content-Type": "application/json",
                },
                timeout=self.timeout_s,
            )
            resp.raise_for_status()
            payload = resp.json()
        except httpx.HTTPError as exc:
            raise StorageError(
                f"Object storage signed URL request failed: {exc}"
            ) from exc

        signed_url_path = payload.get("signedURL") or payload.get("signed_url")
        if not signed_url_path:
            raise StorageError(
                "Object storage signed URL response did not include a URL"
            )

        # Supabase returns a path like "/object/sign/<bucket>/<path>?token=..."
        # — prepend the base URL so callers get a complete URL.
        if signed_url_path.startswith("http"):
            return signed_url_path
        return f"{self.base_url.rstrip('/')}/storage/v1{signed_url_path}"

    def delete_object(self, path: str) -> None:
        try:
            resp = httpx.delete(
                self._api_url("", path),
                headers=self._auth_headers(),
                timeout=self.timeout_s,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise StorageError(f"Object storage delete failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Factory + DI
# ---------------------------------------------------------------------------

# Cache the client across requests — httpx itself isn't being held open
# (each call is a new short-lived connection), but the dataclass + key
# materialization is cheap-but-not-free, and there's no value in
# rebuilding it per request.
_storage_client_singleton: StorageClient | None = None


def get_storage_client() -> StorageClient:
    """FastAPI dependency. Returns a configured StorageClient.

    Tests override this dependency via FastAPI's
    ``app.dependency_overrides[get_storage_client]`` to inject an
    in-memory fake. The conftest pattern matches how the Google
    Places fetcher is swapped.

    Raises ``StorageError`` if any of the three required env vars are
    missing — the upload route surfaces this as a 503 so the client
    can show a clean "evidence upload temporarily unavailable" toast
    instead of a 500.
    """
    global _storage_client_singleton

    if _storage_client_singleton is not None:
        return _storage_client_singleton

    base_url = settings.SUPABASE_URL
    service_role_key = settings.SUPABASE_SERVICE_ROLE_KEY
    bucket = settings.SUPABASE_STORAGE_BUCKET

    if not (base_url and service_role_key and bucket):
        raise StorageError(
            "Object storage is not configured "
            "(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / "
            "SUPABASE_STORAGE_BUCKET). Set these in the environment."
        )

    _storage_client_singleton = SupabaseStorageClient(
        base_url=base_url,
        service_role_key=service_role_key,
        bucket=bucket,
    )
    return _storage_client_singleton
