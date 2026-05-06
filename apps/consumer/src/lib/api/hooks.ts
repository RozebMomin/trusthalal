/**
 * TanStack Query hooks for the consumer site.
 *
 * Phase 9a footprint is intentionally tiny — just the auth surface
 * (sign in, sign up, /me self-lookup, sign out) so the AppShell can
 * branch on "is this person logged in?" Subsequent phases append
 * search hooks (9b), place detail hooks (9c), and preferences (9d).
 *
 * Type-via-codegen pattern matches apps/admin and apps/owner: every
 * shape comes from `components["schemas"]["..."]` so contract drift
 * is a tsc error, not a runtime surprise.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ApiError, apiFetch } from "./client";
import type { components } from "./schema";

// ---------------------------------------------------------------------------
// Auth shapes
// ---------------------------------------------------------------------------

export type UserRole = components["schemas"]["UserRole"];

/**
 * `/me` response. Hand-typed because the endpoint currently returns
 * a plain dict (no `response_model` on the FastAPI side). Same
 * posture as apps/owner's hand type — when the server route grows a
 * Pydantic model, this gets replaced via codegen.
 */
export type MeRead = {
  id: string;
  role: UserRole;
  email: string | null;
  display_name: string | null;
};

/**
 * Awaiting next codegen pass — swap to
 * ``components["schemas"]["LoginRequest"]`` /
 * ``components["schemas"]["LoginResponse"]`` after running
 * `make export-openapi && npm run codegen`.
 */
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

/**
 * Awaiting next codegen pass — same caveat as LoginRequest. The
 * server-side ``/auth/signup`` endpoint accepts an optional ``role``
 * (defaults to OWNER); the consumer site explicitly passes
 * ``CONSUMER`` so users created here don't show up in the owner
 * portal's role gate.
 */
export type SignupRequest = {
  email: string;
  password: string;
  display_name?: string | null;
  role?: UserRole;
};

export type SignupResponse = {
  user_id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  redirect_path: string;
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const qk = {
  me: () => ["me"] as const,
} as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Whoever the current session cookie resolves to. ``data`` is null
 * when unauthenticated; 401s don't retry.
 *
 * Used by:
 *   * The AppShell to render the right header (anonymous vs
 *     signed-in).
 *   * The login / signup pages to redirect away when the user is
 *     already signed in.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: qk.me(),
    queryFn: async () => {
      try {
        return await apiFetch<MeRead>("/me");
      } catch (err) {
        // 401 from /me is the signal for "not signed in" — resolve
        // to null so callers can render anonymous content instead of
        // a loading spinner forever. Other errors re-throw.
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function invalidateMe(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: qk.me() });
}

/**
 * POST /auth/login. On success the API sets the session cookie via
 * Set-Cookie; we invalidate /me so the AppShell sees the new user
 * immediately.
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
 * POST /auth/signup with role=CONSUMER. The consumer site never
 * creates owner accounts; passing the role explicitly avoids
 * relying on the server's default and surfaces "this user came
 * from the consumer surface" to staff if they ever audit.
 */
export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SignupRequest) =>
      apiFetch<SignupResponse>("/auth/signup", {
        method: "POST",
        json: { role: "CONSUMER", ...payload },
      }),
    onSuccess: () => {
      void invalidateMe(qc);
    },
  });
}

/**
 * POST /auth/logout. Idempotent server-side. Clears every cached
 * query so the next user's data doesn't reuse the prior user's
 * fetched rows.
 */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
    },
  });
}
