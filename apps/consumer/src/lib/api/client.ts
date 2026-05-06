/**
 * Thin fetch wrapper around the Trust Halal API for the owner portal.
 *
 * Mirrors apps/admin's client: prefix paths with config.apiBaseUrl,
 * send the session cookie via ``credentials: "include"``, JSON-(de)
 * serialize bodies, normalize ``ErrorResponse`` envelopes into
 * ``ApiError``.
 *
 * Auth is the same single-cookie-on-the-API-origin posture as the
 * admin panel: sign in at /auth/login, the server sets a tht_session
 * HttpOnly cookie on api.trusthalal.org, every request afterwards
 * carries it.
 *
 * Until codegen lands a generated ``schema.d.ts`` here, the
 * ``ApiErrorShape`` type is hand-defined to match
 * api/app/core/exception_handlers.py's ErrorResponse model. Running
 * ``npm run codegen`` will replace this with the canonical generated
 * type the same way it does in the admin app.
 */

import * as Sentry from "@sentry/nextjs";

import { config } from "@/lib/config";

/**
 * Pluck ``X-Request-ID`` off every API response and tag any Sentry
 * events that follow. This is what makes a single request show up
 * under the same correlation key on the browser AND server sides
 * of an issue. Frontend tags ``last_request_id`` on the scope; the
 * FastAPI middleware tags ``request_id`` on its scope. Same value,
 * just different tag names per side.
 */
function captureRequestId(res: Response): void {
  const requestId = res.headers.get("X-Request-ID");
  if (!requestId) return;
  try {
    Sentry.addBreadcrumb({
      category: "http.request_id",
      level: "info",
      message: requestId,
      data: {
        url: new URL(res.url).pathname,
        status: res.status,
      },
    });
    Sentry.setTag("last_request_id", requestId);
  } catch {
    // Sentry not initialized (no DSN) — addBreadcrumb is normally a
    // no-op, but URL parsing can throw on edge cases. Swallow.
  }
}

/**
 * Wire shape of every 4xx / 5xx body the API emits. Hand-mirrored
 * from FastAPI's ``ErrorResponse`` until we run codegen on this app
 * for the first time.
 */
export type ApiErrorShape = {
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  /** JSON-encoded automatically if provided. */
  json?: unknown;
  /**
   * Multipart upload body. When set, ``json`` is ignored and the
   * browser picks the multipart Content-Type + boundary itself
   * (we explicitly do NOT set Content-Type on the request, since
   * doing so breaks the browser's auto-boundary).
   */
  formData?: FormData;
  /** Query string params; undefined values are dropped. */
  searchParams?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(path: string, searchParams?: RequestOptions["searchParams"]) {
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    config.apiBaseUrl,
  );
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiFetch<T = unknown>(
  path: string,
  { json, formData, searchParams, headers, ...init }: RequestOptions = {},
): Promise<T> {
  // Pick the body + content-type strategy. formData wins if both are
  // somehow set (callers shouldn't, but defensive default avoids
  // surprises).
  let body: BodyInit | undefined;
  let extraHeaders: Record<string, string> = {};
  if (formData !== undefined) {
    body = formData;
    // Intentionally NO Content-Type — the browser sets the multipart
    // boundary header automatically based on the FormData contents.
  } else if (json !== undefined) {
    body = JSON.stringify(json);
    extraHeaders["Content-Type"] = "application/json";
  }

  const res = await fetch(buildUrl(path, searchParams), {
    ...init,
    headers: {
      Accept: "application/json",
      ...extraHeaders,
      ...(headers ?? {}),
    },
    body,
    // ``include`` sends the session cookie across origins (api on
    // api.trusthalal.org, owner portal on owner.trusthalal.org). The
    // API's CORS middleware needs ``allow_credentials=True`` and an
    // explicit origin allow-list (no ``*``); both are configured in
    // app/main.py and CORS_ORIGINS env var.
    credentials: "include",
  });

  captureRequestId(res);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const shape = parsed as ApiErrorShape | undefined;
    const code = shape?.error?.code ?? "http_error";
    const message = shape?.error?.message ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, code, message, shape?.error?.detail);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
