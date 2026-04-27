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

/** Mirrors OrganizationStatus on the server. */
export type OrganizationStatus =
  | "DRAFT"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "REJECTED";

/**
 * Statuses an org has to be at to sponsor a claim. Mirrors the
 * server's gate in the /me/ownership-requests handler — DRAFT
 * orgs aren't eligible until the owner submits them for review.
 */
export const ORG_ELIGIBLE_FOR_CLAIM: ReadonlyArray<OrganizationStatus> = [
  "UNDER_REVIEW",
  "VERIFIED",
];

/** Metadata row for an uploaded org supporting document. */
export type OrganizationAttachmentRead = {
  id: string;
  organization_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
};

/** Compact org summary embedded inside MyOwnershipRequestRead. */
export type MyOwnershipRequestOrgSummary = {
  id: string;
  name: string;
  status: OrganizationStatus;
};

/** GET /me/organizations row + most owner-facing org responses. */
export type MyOrganizationRead = {
  id: string;
  name: string;
  contact_email: string | null;
  status: OrganizationStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  attachments: OrganizationAttachmentRead[];
};

export type MyOrganizationCreate = {
  name: string;
  contact_email?: string | null;
};

export type MyOrganizationPatch = {
  name?: string;
  contact_email?: string | null;
};

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

/** Slim shape returned by GET /places/google/autocomplete. */
export type GoogleAutocompletePrediction = {
  google_place_id: string;
  description: string;
  primary_text: string | null;
  secondary_text: string | null;
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

/** Metadata row for an uploaded evidence file. */
export type OwnershipRequestAttachmentRead = {
  id: string;
  request_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
};

/** GET /me/ownership-requests row + POST response. */
export type MyOwnershipRequestRead = {
  id: string;
  place: MyOwnershipRequestPlaceSummary;
  organization: MyOwnershipRequestOrgSummary | null;
  status: OwnershipRequestStatus;
  message: string | null;
  created_at: string;
  updated_at: string;
  attachments: OwnershipRequestAttachmentRead[];
};

/**
 * POST /me/ownership-requests body.
 *
 * organization_id is required — the server gates on the org being
 * one the caller belongs to and at least UNDER_REVIEW.
 *
 * Exactly one of ``place_id`` (an existing Trust Halal place) and
 * ``google_place_id`` (a Google place we'll ingest first) must be
 * provided. The server validates this with a model-level check; the
 * TypeScript type is permissive at the leaf level so the UI's
 * picked-place union can write either field directly.
 */
export type MyOwnershipRequestCreate = {
  organization_id: string;
  place_id?: string;
  google_place_id?: string;
  message?: string | null;
  contact_phone?: string | null;
};

/**
 * Return shape of GET /me. Includes display_name + email so the
 * portal can render "Signed in as <name>" without a second roundtrip.
 * display_name is nullable: legacy admin-invited users may have NULL
 * there. email is typed as nullable for symmetry with the column,
 * but is non-null in practice for any active user.
 */
export type MeRead = {
  id: string;
  role: UserRole;
  display_name: string | null;
  email: string | null;
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
  myOrganizations: () => ["me", "organizations"] as const,
  myOrganization: (id: string) => ["me", "organizations", id] as const,
  placesSearch: (q: string) => ["places", "search", q] as const,
  placesGoogleAutocomplete: (q: string) =>
    ["places", "google", "autocomplete", q] as const,
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
 * GET /places/google/autocomplete — server-side proxy to Google
 * Places Autocomplete. Powers the "Can't find your restaurant?
 * Search Google" fallback in the claim flow when no Trust Halal
 * match exists for the typed query.
 *
 * Disabled while empty so the proxy isn't called on a no-op input
 * (which would also 422 server-side from the min_length=1 guard).
 */
export function usePlacesGoogleAutocomplete(q: string, enabled = true) {
  const trimmed = q.trim();
  return useQuery<GoogleAutocompletePrediction[]>({
    queryKey: qk.placesGoogleAutocomplete(trimmed),
    queryFn: () =>
      apiFetch<GoogleAutocompletePrediction[]>("/places/google/autocomplete", {
        searchParams: { q: trimmed },
      }),
    enabled: enabled && trimmed.length > 0,
    // Google predictions for the same query are stable for a few
    // minutes; cache long enough to absorb a back-button rerender
    // but short enough that a fresh search after editing the input
    // shows current results.
    staleTime: 60 * 1000,
  });
}

/**
 * POST /me/ownership-requests/{request_id}/attachments — upload a
 * single file as evidence on an existing claim.
 *
 * Per-mutation rather than per-claim because each file is a separate
 * multipart request. The /claim page's submit handler kicks off N
 * uploads in parallel (one per selected file) after the parent
 * claim is created. Invalidates the my-claims list on success so the
 * filename appears under the claim immediately.
 */
export function useUploadOwnershipRequestAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { requestId: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", args.file);
      return apiFetch<OwnershipRequestAttachmentRead>(
        `/me/ownership-requests/${args.requestId}/attachments`,
        { method: "POST", formData: fd },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myOwnershipRequests() });
    },
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

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/**
 * GET /me/organizations — every org the signed-in user is an
 * ACTIVE member of.
 *
 * Used by:
 *   * /my-organizations list page
 *   * /claim page's sponsoring-org picker (filtered to
 *     ORG_ELIGIBLE_FOR_CLAIM client-side)
 */
export function useMyOrganizations() {
  return useQuery<MyOrganizationRead[]>({
    queryKey: qk.myOrganizations(),
    queryFn: () => apiFetch<MyOrganizationRead[]>("/me/organizations"),
    // Org status changes infrequently (admin reviews are async); cache
    // generously, refetch on focus so a freshly-verified org appears
    // when the owner returns to the tab.
    staleTime: 30 * 1000,
  });
}

/** GET /me/organizations/{id} — detail with attachments embedded. */
export function useMyOrganization(id: string | null | undefined) {
  return useQuery<MyOrganizationRead>({
    queryKey: qk.myOrganization(id ?? "__nil__"),
    queryFn: () =>
      apiFetch<MyOrganizationRead>(`/me/organizations/${id}`),
    enabled: typeof id === "string" && id.length > 0,
    staleTime: 15 * 1000,
  });
}

/** POST /me/organizations — create at DRAFT. */
export function useCreateMyOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MyOrganizationCreate) =>
      apiFetch<MyOrganizationRead>("/me/organizations", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myOrganizations() });
    },
  });
}

/**
 * PATCH /me/organizations/{id} — name + contact_email updates.
 * Allowed only while DRAFT or UNDER_REVIEW.
 */
export function usePatchMyOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      organizationId: string;
      patch: MyOrganizationPatch;
    }) =>
      apiFetch<MyOrganizationRead>(
        `/me/organizations/${args.organizationId}`,
        { method: "PATCH", json: args.patch },
      ),
    onSuccess: (data) => {
      // Invalidate both the list and the specific detail entry so
      // every consumer of the cache picks up the rename.
      void qc.invalidateQueries({ queryKey: qk.myOrganizations() });
      void qc.invalidateQueries({ queryKey: qk.myOrganization(data.id) });
    },
  });
}

/**
 * POST /me/organizations/{id}/submit — DRAFT → UNDER_REVIEW.
 * Server enforces "at least one attachment" and idempotents on
 * already-submitted orgs.
 */
export function useSubmitMyOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) =>
      apiFetch<MyOrganizationRead>(
        `/me/organizations/${organizationId}/submit`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: qk.myOrganizations() });
      void qc.invalidateQueries({ queryKey: qk.myOrganization(data.id) });
    },
  });
}

/**
 * POST /me/organizations/{id}/attachments — multipart upload of
 * a supporting document (articles of organization, business filing,
 * etc.). Same per-mutation pattern as the claim attachment hook.
 */
export function useUploadMyOrganizationAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { organizationId: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", args.file);
      return apiFetch<OrganizationAttachmentRead>(
        `/me/organizations/${args.organizationId}/attachments`,
        { method: "POST", formData: fd },
      );
    },
    onSuccess: (_data, args) => {
      // Refresh both list (file count badge) and detail (full
      // filename listing).
      void qc.invalidateQueries({ queryKey: qk.myOrganizations() });
      void qc.invalidateQueries({
        queryKey: qk.myOrganization(args.organizationId),
      });
    },
  });
}
