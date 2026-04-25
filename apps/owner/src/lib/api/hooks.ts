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

/** Mirrors OwnershipRequestStatus on the server. */
export type OwnershipRequestStatus =
  | "SUBMITTED"
  | "NEEDS_EVIDENCE"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

/** Result row of GET /places?q=... — lightweight place fields. */
export type PlaceSearchResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country_code: string | null;
};

/** Place sub-shape embedded in MyOwnershipRequestRead. */
export type MyOwnershipRequestPlaceSummary = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
};

/** GET /me/ownership-requests row + POST response. */
export type MyOwnershipRequestRead = {
  id: string;
  place: MyOwnershipRequestPlaceSummary;
  status: OwnershipRequestStatus;
  message: string | null;
  created_at: string;
  updated_at: string;
};

/** POST /me/ownership-requests body. */
export type MyOwnershipRequestCreate = {
  place_id: string;
  message?: string | null;
  contact_phone?: string | null;
};

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

export type SignupRequest = {
  email: string;
  password: string;
  display_name: string;
};

// Same wire shape as LoginResponse — signup auto-logs the user in via
// the session cookie so the client treats both responses identically.
export type SignupResponse = LoginResponse;

const qk = {
  me: () => ["me"] as const,
  myOwnershipRequests: () => ["me", "ownership-requests"] as const,
  placesSearch: (q: string) => ["places", "search", q] as const,
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
 * POST /auth/signup. Public self-service path for restaurant owners.
 *
 * The server hard-codes role=OWNER and auto-logs the new user in by
 * setting the session cookie on success — same response shape as
 * /auth/login, so the calling page can route to ``redirect_path``
 * identically. We invalidate /me so AppShell flips from "not signed
 * in" to "OWNER" without a hard reload.
 *
 * The `EMAIL_TAKEN` failure code surfaces as ApiError on the caller —
 * the signup page branches on it to show "this email is already
 * registered, sign in instead?".
 */
export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SignupRequest) =>
      apiFetch<SignupResponse>("/auth/signup", {
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

// ---------------------------------------------------------------------------
// Claim flow
// ---------------------------------------------------------------------------

/**
 * GET /places?q=... — text search the public catalog.
 *
 * Disabled while the query string is empty so the type-as-you-go
 * search doesn't fire a request on every keystroke before the user
 * has typed anything meaningful. The caller debounces on top.
 *
 * staleTime is small (10s) so a fresh-search-after-ingest doesn't
 * keep showing stale results, but the cache still absorbs the
 * usual back-button re-renders.
 */
export function usePlacesSearch(q: string, enabled = true) {
  const trimmed = q.trim();
  return useQuery<PlaceSearchResult[]>({
    queryKey: qk.placesSearch(trimmed),
    queryFn: () =>
      apiFetch<PlaceSearchResult[]>("/places", {
        searchParams: { q: trimmed, limit: 10 },
      }),
    enabled: enabled && trimmed.length > 0,
    staleTime: 10 * 1000,
  });
}

/**
 * GET /me/ownership-requests — the signed-in user's claims, newest
 * first. Powers the home page's "Recent claims" preview and the
 * /my-claims list. Server scopes results to current_user; nothing to
 * send.
 */
export function useMyOwnershipRequests() {
  return useQuery<MyOwnershipRequestRead[]>({
    queryKey: qk.myOwnershipRequests(),
    queryFn: () =>
      apiFetch<MyOwnershipRequestRead[]>("/me/ownership-requests"),
    // Claims don't change on a hot loop — admin staff reviews in the
    // background. Cache for 30s, refetch on focus so a freshly
    // approved/rejected claim shows up when the user comes back to
    // the tab.
    staleTime: 30 * 1000,
  });
}

/**
 * POST /me/ownership-requests — submit a claim against an existing
 * place. Server auto-fills contact_name/contact_email from the
 * signed-in user. Invalidates the my-claims list on success so the
 * post-submit redirect picks up the new row immediately.
 */
export function useCreateMyOwnershipRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MyOwnershipRequestCreate) =>
      apiFetch<MyOwnershipRequestRead>("/me/ownership-requests", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myOwnershipRequests() });
    },
  });
}
