/**
 * TanStack Query hooks for the owner portal.
 *
 * Intentionally small for v1 — just enough to authenticate and read
 * the current user. Owner-specific endpoints (my places, my claims,
 * my org) get added here as the portal grows.
 *
 * Hand-typed shapes for now; replace with generated
 * ``components["schemas"][...]`` after ``npm run codegen``.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "./client";

// Mirrors UserRole on the server. Hand-typed until codegen runs.
export type UserRole = "ADMIN" | "VERIFIER" | "OWNER" | "CONSUMER";

/**
 * Return shape of GET /me. Same as the admin panel's MeRead — kept
 * tight on purpose so the cookie roundtrip is cheap.
 */
export type MeRead = {
  id: string;
  role: UserRole;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  user_id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  redirect_path: string;
};

const qk = {
  me: () => ["me"] as const,
} as const;

/**
 * GET /me — figure out who the cookie says you are.
 *
 * Returns null when unauthenticated (the server 401s, which we map
 * to null here so AppShell can branch on "is there a logged-in
 * user?" without wiring catch blocks everywhere).
 */
export function useCurrentUser() {
  return useQuery<MeRead | null>({
    queryKey: qk.me(),
    queryFn: async () => {
      try {
        return await apiFetch<MeRead>("/me");
      } catch {
        // 401 / network error → treat as not-signed-in. Keeps the
        // AppShell branching simple at the cost of swallowing
        // genuine network errors silently. Acceptable tradeoff for
        // an auth check.
        return null;
      }
    },
    // Auth state changes rarely; refetching every focus would be
    // wasteful. AppShell explicitly invalidates on login/logout.
    staleTime: 5 * 60 * 1000,
  });
}

function invalidateMe(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: qk.me() });
}

/**
 * POST /auth/login. The server sets the session cookie via
 * Set-Cookie; we invalidate /me so the next render picks up the
 * authenticated state.
 */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginRequest) =>
      apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void invalidateMe(qc);
    },
  });
}

/**
 * POST /auth/logout. Idempotent server-side. Clears every TanStack
 * Query cache entry on success — the next user's data shouldn't
 * leak across sessions.
 */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
    },
  });
}
