import Constants from "expo-constants";
import { tokenStore } from "@/lib/auth/token-store";
import type { MobileAuthResponse } from "./types";

const BASE: string =
  Constants.expoConfig?.extra?.apiBaseUrl ?? "https://api.trusthalal.org";

/** Same envelope + fields as apps/consumer's ApiError — sacred convention. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    return new ApiError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? "Something went wrong.",
    );
  } catch {
    return new ApiError(res.status, "UNKNOWN", "Something went wrong.");
  }
}

let refreshing: Promise<boolean> | null = null;

/** Rotate the refresh token for a new pair. Single-flight so parallel
 *  401s don't burn the single-use refresh token twice. */
async function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const { refresh } = await tokenStore.get();
    if (!refresh) return false;
    let res: Response;
    try {
      res = await fetch(`${BASE}/auth/mobile/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      // Network error — the refresh token may still be perfectly valid.
      // Keep it; the caller sees the original failure and can retry.
      return false;
    }
    if (res.ok) {
      const body = (await res.json()) as MobileAuthResponse;
      await tokenStore.set({
        access: body.access_token,
        refresh: body.refresh_token,
      });
      return true;
    }
    // Only clear on a definitive "this token is no longer valid" (401/403).
    // A transient 5xx / 429 must NOT nuke a still-valid 30-day refresh
    // token and force an unnecessary re-login.
    if (res.status === 401 || res.status === 403) {
      await tokenStore.clear();
    }
    return false;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {},
  retried = false,
): Promise<T> {
  const { access } = await tokenStore.get();
  const headers = new Headers(opts.headers);
  if (access) headers.set("Authorization", `Bearer ${access}`);
  headers.set("Accept", "application/json");
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (res.status === 401 && access && !retried) {
    if (await tryRefresh()) return apiFetch<T>(path, opts, true);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
