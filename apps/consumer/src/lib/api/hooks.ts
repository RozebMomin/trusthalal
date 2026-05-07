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
// Halal-profile + place-search shapes
// ---------------------------------------------------------------------------
// Hand-typed mirrors of the server-side Pydantic models in
// ``app/modules/places/schemas.py`` and
// ``app/modules/halal_profiles/enums.py``. Replace with
// ``components["schemas"][...]`` after running
// ``make export-openapi && npm run codegen`` so contract drift is a
// tsc error rather than a runtime surprise.

export type ValidationTier =
  | "SELF_ATTESTED"
  | "CERTIFICATE_ON_FILE"
  | "TRUST_HALAL_VERIFIED";

export type MenuPosture =
  | "FULLY_HALAL"
  | "MIXED_SEPARATE_KITCHENS"
  | "HALAL_OPTIONS_ADVERTISED"
  | "HALAL_UPON_REQUEST"
  | "MIXED_SHARED_KITCHEN";

export type AlcoholPolicy = "NONE" | "BEER_AND_WINE_ONLY" | "FULL_BAR";

export type SlaughterMethod = "ZABIHAH" | "MACHINE" | "NOT_SERVED";

export type DisputeState = "NONE" | "DISPUTED" | "RECONCILING";

/**
 * Embedded halal profile as it lands inside a search result or place
 * detail. Mirrors ``HalalProfileEmbed`` server-side. Null when the
 * place has no approved claim or the profile was revoked.
 */
export type HalalProfileEmbed = {
  id: string;
  place_id: string;
  validation_tier: ValidationTier;
  menu_posture: MenuPosture;
  has_pork: boolean;
  alcohol_policy: AlcoholPolicy;
  alcohol_in_cooking: boolean;
  chicken_slaughter: SlaughterMethod;
  beef_slaughter: SlaughterMethod;
  lamb_slaughter: SlaughterMethod;
  goat_slaughter: SlaughterMethod;
  seafood_only: boolean;
  has_certification: boolean;
  certifying_body_name: string | null;
  certificate_expires_at: string | null;
  caveats: string | null;
  dispute_state: DisputeState;
  last_verified_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  updated_at: string;
};

export type PlaceSearchResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country_code: string | null;
  /** Embedded halal profile — null when the place has no approved
   * claim or the profile was revoked. The search result row renders
   * a "no halal profile yet" affordance in that case. */
  halal_profile: HalalProfileEmbed | null;
};

/**
 * GET /places/{id} response. Mirrors ``PlaceDetail`` server-side.
 * Hand-typed for the same reason ``PlaceSearchResult`` is — codegen
 * will land it next pass.
 */
export type PlaceDetail = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  is_deleted: boolean;
  city: string | null;
  region: string | null;
  country_code: string | null;
  postal_code: string | null;
  timezone: string | null;
  updated_at: string | null;
  halal_profile: HalalProfileEmbed | null;
};

// ---------------------------------------------------------------------------
// Dispute shapes
// ---------------------------------------------------------------------------

export type DisputeStatus =
  | "OPEN"
  | "OWNER_RECONCILING"
  | "ADMIN_REVIEWING"
  | "RESOLVED_UPHELD"
  | "RESOLVED_DISMISSED"
  | "WITHDRAWN";

export type DisputedAttribute =
  | "PORK_SERVED"
  | "ALCOHOL_PRESENT"
  | "MENU_POSTURE_INCORRECT"
  | "SLAUGHTER_METHOD_INCORRECT"
  | "CERTIFICATION_INVALID"
  | "PLACE_CLOSED"
  | "OTHER";

export type ConsumerDisputeAttachment = {
  id: string;
  dispute_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
};

/** Payload for ``POST /places/{place_id}/disputes``. */
export type ConsumerDisputeCreate = {
  disputed_attribute: DisputedAttribute;
  description: string;
};

/** Reporter-self view returned by /me/disputes endpoints. */
export type ConsumerDisputeReporter = {
  id: string;
  place_id: string;
  status: DisputeStatus;
  disputed_attribute: DisputedAttribute;
  description: string;
  attachments: ConsumerDisputeAttachment[];
  submitted_at: string;
  decided_at: string | null;
  admin_decision_note: string | null;
};

/**
 * Inputs to the public ``GET /places`` search endpoint. Mirrors the
 * Query() params on ``api/app/modules/places/router.py``. Either a
 * non-empty ``q`` or the geo trio (lat + lng + radius) must be
 * present; the server returns ``PLACES_SEARCH_PARAMS_REQUIRED``
 * otherwise.
 */
export type SearchPlacesParams = {
  q?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  limit?: number;
  offset?: number;
  // Halal preference filters — all optional, all narrow the result.
  min_validation_tier?: ValidationTier;
  min_menu_posture?: MenuPosture;
  has_certification?: boolean;
  no_pork?: boolean;
  no_alcohol_served?: boolean;
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const qk = {
  me: () => ["me"] as const,
  placesSearch: (params: SearchPlacesParams) =>
    ["places", "search", params] as const,
  placeDetail: (placeId: string) => ["places", "detail", placeId] as const,
  myDisputes: () => ["me", "disputes"] as const,
  reverseGeocode: (lat: number, lng: number) =>
    ["places", "reverse-geocode", lat, lng] as const,
} as const;

/**
 * Result shape from the consumer "near me" reverse-geocode proxy.
 * Mirrors ``ReverseGeocodeResult`` server-side. All three fields are
 * optional — Google can resolve a country but no locality for rural
 * coordinates, and the consumer pill falls back gracefully when
 * `city` is null.
 */
export type ReverseGeocodeResult = {
  city: string | null;
  region: string | null;
  country_code: string | null;
};

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

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * GET /places — public catalog search.
 *
 * Stays disabled until the caller passes a non-empty ``q`` (Phase 9b
 * focuses on the text-search path; geo-search lands when we add a
 * "near me" surface). The page tracks ``params`` in the URL query
 * string, so a search result is shareable.
 *
 * Halal-preference filters are passed through verbatim to the
 * server. Each filter narrows results — places without a matching
 * profile drop out entirely (the server does an INNER JOIN on
 * ``halal_profiles`` when any filter is set; otherwise a LEFT
 * OUTER JOIN so unprofiled places still appear with
 * ``halal_profile=null``).
 */
export function useSearchPlaces(params: SearchPlacesParams) {
  const enabled = Boolean(
    (params.q && params.q.trim().length > 0) ||
      (params.lat !== undefined &&
        params.lng !== undefined &&
        params.radius !== undefined),
  );
  return useQuery<PlaceSearchResult[]>({
    queryKey: qk.placesSearch(params),
    queryFn: () =>
      apiFetch<PlaceSearchResult[]>("/places", {
        searchParams: {
          q: params.q,
          lat: params.lat,
          lng: params.lng,
          radius: params.radius,
          limit: params.limit,
          offset: params.offset,
          min_validation_tier: params.min_validation_tier,
          min_menu_posture: params.min_menu_posture,
          has_certification: params.has_certification,
          no_pork: params.no_pork,
          no_alcohol_served: params.no_alcohol_served,
        },
      }),
    enabled,
    // Search results live a little longer than the 30s default — the
    // public catalog doesn't churn quickly, and a refresh-on-back
    // navigation flicker is worse than a slightly stale list.
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Reverse geocode (near-me city label)
// ---------------------------------------------------------------------------

/**
 * GET /places/google/reverse-geocode — proxy to Google Geocoding.
 *
 * Powers the "Searching X mi around <City>" label on the near-me
 * pill. Disabled when lat/lng aren't both finite numbers (the hook
 * gets called from a component that may render before the user has
 * granted geolocation, so guard against the partial-coords case).
 *
 * Cached aggressively: a coordinate's city doesn't change minute to
 * minute, and toggling near-me on/off shouldn't fire a fresh Google
 * call every time. The 24-hour staleTime + queryKey-based dedupe by
 * coords cover both.
 *
 * Lat/lng are quantized to 4 decimal places (~11m) before keying so
 * tiny GPS jitter between activations doesn't bust the cache.
 */
export function useReverseGeocode(
  lat: number | undefined,
  lng: number | undefined,
) {
  const enabled =
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng);

  const quantizedLat = enabled ? Number(lat!.toFixed(4)) : 0;
  const quantizedLng = enabled ? Number(lng!.toFixed(4)) : 0;

  return useQuery<ReverseGeocodeResult>({
    queryKey: qk.reverseGeocode(quantizedLat, quantizedLng),
    queryFn: () =>
      apiFetch<ReverseGeocodeResult>("/places/google/reverse-geocode", {
        searchParams: {
          lat: quantizedLat,
          lng: quantizedLng,
        },
      }),
    enabled,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    // The pill is decoration — failures are silent. The active pill
    // falls back to "around you" when this hook returns no data.
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Place detail
// ---------------------------------------------------------------------------

/**
 * GET /places/{id} — full place + embedded halal profile.
 *
 * Returns 404 (PLACE_NOT_FOUND) when the place doesn't exist or has
 * been hard-deleted; soft-deleted places resolve with
 * ``is_deleted: true`` so the page can render a tombstone instead of
 * a generic "not found" wall.
 *
 * Disabled when ``placeId`` is empty so the hook is safe to call from
 * a route component that hasn't yet resolved the param.
 */
export function usePlaceDetail(placeId: string) {
  return useQuery<PlaceDetail>({
    queryKey: qk.placeDetail(placeId),
    queryFn: () => apiFetch<PlaceDetail>(`/places/${placeId}`),
    enabled: Boolean(placeId),
    // Same staleness window as search — the public read is cheap and
    // the data doesn't churn quickly. A revoke or new approval will
    // beat the cache via TanStack's window-focus refetch.
    staleTime: 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

/**
 * GET /me/disputes — the caller's own disputes, newest-first.
 *
 * The detail page uses this to:
 *   * Filter out places the caller has already disputed (so the
 *     "File a dispute" button can hint at "you already filed one").
 *   * Render a small "Your reports for this place" section so the
 *     caller can track their own follow-ups.
 *
 * Disabled when there's no signed-in user — the endpoint requires
 * auth and would 401 otherwise.
 */
export function useMyDisputes(opts: { enabled?: boolean } = {}) {
  return useQuery<ConsumerDisputeReporter[]>({
    queryKey: qk.myDisputes(),
    queryFn: () => apiFetch<ConsumerDisputeReporter[]>("/me/disputes"),
    enabled: opts.enabled !== false,
    staleTime: 30_000,
  });
}

/**
 * POST /places/{place_id}/disputes — file a new dispute.
 *
 * On success we invalidate two caches:
 *   * ``qk.myDisputes()`` so the caller's "your reports" section
 *     picks up the new row immediately.
 *   * ``qk.placeDetail(place_id)`` so the embedded halal profile's
 *     dispute_state badge updates without a manual refresh — the
 *     server flips it to DISPUTED on first OPEN dispute.
 */
export function useFileDispute(placeId: string) {
  const qc = useQueryClient();
  return useMutation<
    ConsumerDisputeReporter,
    ApiError,
    ConsumerDisputeCreate
  >({
    mutationFn: (payload) =>
      apiFetch<ConsumerDisputeReporter>(`/places/${placeId}/disputes`, {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myDisputes() });
      void qc.invalidateQueries({ queryKey: qk.placeDetail(placeId) });
    },
  });
}

/**
 * POST /me/disputes/{dispute_id}/attachments — multipart upload.
 *
 * The fileDispute → uploadAttachment chain is two requests because
 * the dispute id is server-generated; the dialog runs them
 * sequentially after the dispute is created. We skip cache
 * invalidation here — the only consumer of attachment metadata is
 * the dispute itself, and the user already sees their selected file
 * names in the dialog.
 */
export function useUploadDisputeAttachment() {
  return useMutation<
    ConsumerDisputeAttachment,
    ApiError,
    { disputeId: string; file: File }
  >({
    mutationFn: ({ disputeId, file }) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiFetch<ConsumerDisputeAttachment>(
        `/me/disputes/${disputeId}/attachments`,
        { method: "POST", formData: fd },
      );
    },
  });
}
