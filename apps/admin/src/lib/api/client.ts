/**
 * Thin fetch wrapper around trusthalal-api.
 *
 * Responsibilities:
 *   - prefix all paths with config.apiBaseUrl
 *   - send the session cookie via ``credentials: "include"``
 *   - JSON (de)serialize bodies
 *   - normalize ErrorResponse envelopes into ApiError with the
 *     FastAPI error code / status available to callers
 *
 * Authentication is handled entirely by the session cookie set on
 * ``POST /auth/login``. The X-User-Id header shortcut that existed
 * during the pre-auth era is gone — the server ignores it unless
 * DEV_HEADER_AUTH_ENABLED is explicitly flipped on (test harness only).
 */

import { config } from "@/lib/config";

import type { components } from "./schema";

/**
 * Wire shape of every 4xx / 5xx body this API emits. Pulled from the
 * generated OpenAPI schema so it stays in lock-step with the FastAPI
 * ``ErrorResponse`` model — any server-side shape drift is caught at
 * compile time on the next codegen.
 */
export type ApiErrorShape = components["schemas"]["ErrorResponse"];

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
  { json, searchParams, headers, ...init }: RequestOptions = {},
): Promise<T> {
  const res = await fetch(buildUrl(path, searchParams), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    // ``include`` sends the session cookie across origins (api on
    // :8000, admin on :3001 during local dev). Requires the server's
    // CORS middleware to have ``allow_credentials=True`` + an
    // explicit origin — ``*`` is forbidden by the spec when credentials
    // are enabled. Both are configured in app/main.py.
    credentials: "include",
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const shape = body as ApiErrorShape | undefined;
    const code = shape?.error?.code ?? "http_error";
    const message = shape?.error?.message ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, code, message, shape?.error?.detail);
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
