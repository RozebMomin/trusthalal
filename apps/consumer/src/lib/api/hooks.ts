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
  useInfiniteQuery,
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
  /** Whether the account has confirmed its email address. Gates posting
   *  reviews and owner replies; nothing else. */
  email_verified?: boolean;
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
 * Curated cuisine taxonomy. Mirrors the ``Cuisine`` enum on the API.
 * Surfaced on every place via ``cuisine_types`` (multi-valued) and
 * filterable via the multi-value ``cuisine`` query param on
 * GET /places. Display labels live in the UI layer (per-app cuisine
 * picker carries its own short-label map) so the API stays neutral
 * about how each surface chooses to render the value.
 */
export type Cuisine =
  // South Asian
  | "PAKISTANI"
  | "INDIAN"
  | "BANGLADESHI"
  | "SRI_LANKAN"
  | "NEPALI"
  // Middle Eastern
  | "LEBANESE"
  | "TURKISH"
  | "YEMENI"
  | "SYRIAN"
  | "PALESTINIAN"
  | "IRAQI"
  | "PERSIAN"
  | "EGYPTIAN"
  // North African
  | "MOROCCAN"
  | "TUNISIAN"
  | "ALGERIAN"
  // East African
  | "SOMALI"
  | "ETHIOPIAN"
  | "ERITREAN"
  // Central Asian
  | "AFGHAN"
  | "UZBEK"
  // Southeast Asian
  | "INDONESIAN"
  | "MALAYSIAN"
  | "FILIPINO"
  | "THAI"
  // East Asian
  | "CHINESE"
  | "KOREAN"
  | "JAPANESE"
  // European
  | "MEDITERRANEAN"
  | "GREEK"
  | "ITALIAN"
  | "SPANISH"
  // Americas
  | "AMERICAN"
  | "MEXICAN"
  | "CARIBBEAN"
  | "SOUL_FOOD"
  // Format / generic
  | "BURGERS"
  | "PIZZA"
  | "BBQ"
  | "STEAKHOUSE"
  | "SEAFOOD"
  | "SANDWICHES"
  | "DELI"
  | "WINGS"
  | "HOT_DOGS"
  | "BREAKFAST"
  | "BAKERY"
  | "DESSERTS"
  | "CAFE";

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
  /** Public URL of the halal certificate document. Populated by the
   * profile-derivation service when the latest HALAL_CERTIFICATE
   * attachment is copied to the public certs bucket on approval.
   * Null when no cert is on file or the copy step failed (best-
   * effort — approval still commits with a null URL). */
  certificate_url: string | null;
  /** MIME type of the cert (image/jpeg, image/png, application/pdf,
   * etc.). Drives consumer-side viewer choice — image/* renders in
   * an <img>, application/pdf in an <iframe>, anything else falls
   * back to a download link. Null when ``certificate_url`` is null. */
  certificate_content_type: string | null;
  caveats: string | null;
  dispute_state: DisputeState;
  last_verified_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  updated_at: string;
};

/**
 * Source attribution for an uploaded place photo. Mirrors
 * ``PlacePhotoSource`` server-side. Drives the "Owner" / "Customer"
 * badge on the consumer gallery + the hero-eligibility gate.
 */
/** Who supplied a photo, as stored. Includes GOOGLE — the data-ops backfill
 *  writes those and they exist in production today. Prefer `attribution`
 *  below for anything user-visible. */
export type PlacePhotoSource = "OWNER" | "CONSUMER" | "GOOGLE";

/** Display-level provenance, derived server-side.
 *
 *  This exists because each client used to infer provenance from `source`
 *  alone and got it wrong differently: mobile had a VERIFIER label that was
 *  never a real value, and neither client handled GOOGLE, so backfilled
 *  photos rendered a blank chip. Render from this, never from `source`. */
export type PhotoAttribution = "OWNER" | "DINER" | "REVIEW" | "GOOGLE";

/**
 * Photo row as returned by GET /places/{id}/photos and embedded
 * in PlaceDetail.photos. ``url`` is the public Supabase Storage
 * URL — render directly in an <img>, no signing.
 */
export type PlacePhotoRead = {
  id: string;
  place_id: string;
  url: string;
  source: PlacePhotoSource;
  attribution: PhotoAttribution;
  /** Set when the photo was attached to a review, so the gallery can link
   *  back to the words that explain it. */
  review_id: string | null;
  review_rating: number | null;
  width_px: number | null;
  height_px: number | null;
  caption: string | null;
  is_hero: boolean;
  uploaded_by_display_name: string | null;
  created_at: string;
};

/** Why someone flagged a photo. Mirrors PhotoReportReason server-side. */
export type PhotoReportReason =
  | "NOT_THIS_PLACE"
  | "INAPPROPRIATE"
  | "MISLEADING"
  | "PERSONAL_INFO"
  | "COPYRIGHT"
  | "OTHER";

/** POST /places/{id}/photos/{photoId}/report.
 *
 *  This is the only route anyone — including the restaurant — has for a
 *  diner's photo. Owners can't delete them, matching Google and Yelp, and
 *  mattering more here because a photo of what was served is evidence. */
export function useReportPhoto(placeId: string) {
  return useMutation({
    mutationFn: ({
      photoId,
      reason,
      detail,
    }: {
      photoId: string;
      reason: PhotoReportReason;
      detail?: string;
    }) =>
      apiFetch<unknown>(
        `/places/${placeId}/photos/${encodeURIComponent(photoId)}/report`,
        { method: "POST", json: { reason, detail } },
      ),
  });
}


// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewSort = "recent" | "rating_high" | "rating_low";
export type PlaceReviewStatus = "PUBLISHED" | "HIDDEN" | "REMOVED";
export type ReviewReportReason =
  | "SPAM"
  | "OFF_TOPIC"
  | "HARASSMENT"
  | "FALSE_INFO"
  | "CONFLICT_OF_INTEREST"
  | "OTHER";

/** Author identity on a review.
 *
 *  Carries no role, by design — a verifier's review renders exactly like
 *  anyone else's. Verifier standing is earned against facts and doesn't
 *  transfer to weight of opinion about a meal. The server doesn't send the
 *  field, which is what stops a badge creeping back in here. */
export type ReviewAuthorRead = {
  id: string;
  display_name: string | null;
};

export type ReviewPhotoRead = { id: string; url: string };

export type PlaceReviewReplyRead = {
  id: string;
  review_id: string;
  organization_id: string;
  organization_name: string | null;
  body: string;
  edited_at: string | null;
  created_at: string;
};

export type PlaceReviewRead = {
  id: string;
  place_id: string;
  author: ReviewAuthorRead;
  rating: number;
  body: string;
  visited_on: string | null;
  status: PlaceReviewStatus;
  edited_at: string | null;
  created_at: string;
  photos: ReviewPhotoRead[];
  reply: PlaceReviewReplyRead | null;
  /** The review changed after the reply was written, so the reply may be
   *  answering text that is no longer there. Computed server-side so all
   *  clients agree — don't recompute it from the two timestamps. */
  edited_after_reply: boolean;
  is_mine: boolean;
  reported_by_me: boolean;
  moderation_note: string | null;
};

/** Both ratings ride together so a client can label each.
 *
 *  Showing a bare star that silently means Google's is exactly what this
 *  feature exists to stop doing — the two numbers measure different things
 *  over different populations and must never be blended. */
export type ReviewSummary = {
  average: number | null;
  count: number;
  histogram: Record<string, number>;
  google_rating: number | null;
  google_rating_count: number | null;
};

export type PlaceReviewListResponse = {
  summary: ReviewSummary;
  items: PlaceReviewRead[];
  total: number;
  next_offset: number | null;
  /** False when signed out, unverified, or already reviewed — the client
   *  can then explain *why* rather than hiding the button. */
  can_review: boolean;
  my_review_id: string | null;
};

export const REVIEWS_PAGE_SIZE = 10;

/**
 * Paged reviews for a place.
 *
 * Infinite rather than a single fixed fetch: the first version asked for
 * `limit: 10` once and never read `next_offset`, so a place with forty
 * reviews showed ten, permanently, with a "Show all" button that only
 * expanded the ten already in hand. The pagination existed on the server the
 * whole time — nothing called it.
 */
export function usePlaceReviews(placeId: string, sort: ReviewSort = "recent") {
  return useInfiniteQuery<PlaceReviewListResponse>({
    queryKey: ["places", placeId, "reviews", sort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiFetch<PlaceReviewListResponse>(`/places/${placeId}/reviews`, {
        searchParams: {
          sort,
          limit: REVIEWS_PAGE_SIZE,
          offset: pageParam as number,
        },
      }),
    // Server returns null when there's nothing more, so this is the whole
    // termination condition — no arithmetic on our side to get wrong.
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: Boolean(placeId),
  });
}

export type PlaceReviewCreate = {
  rating: number;
  body: string;
  visited_on?: string | null;
  /** Set on the second attempt, after the user has seen the "this reads
   *  heated" nudge and chosen to post anyway. Waives the soft WARN verdict
   *  only — the text is re-scored server-side and profanity still blocks. */
  acknowledged_warning?: boolean;
};

function invalidatePlaceReviews(qc: ReturnType<typeof useQueryClient>, placeId: string) {
  // The place detail itself carries the denormalized aggregate, so it goes
  // stale on every write here too.
  qc.invalidateQueries({ queryKey: ["places", placeId, "reviews"] });
  qc.invalidateQueries({ queryKey: qk.placeDetail(placeId) });
}

/** The author's own review, with enough place context to render a list. */
export type MyReviewRead = PlaceReviewRead & {
  place: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
  } | null;
};

/**
 * GET /me/reviews — everything you've written, including hidden and removed.
 *
 * This is the only surface where a moderated review is visible to the person
 * who wrote it: the public place listing filters to published, so without
 * this page the removal email is the sole channel and a review that lands in
 * a spam folder simply disappears with no explanation.
 *
 * Not cached long. Someone opening this page has usually just been told
 * something about their content and is coming to look.
 */
export function useMyReviews(opts: { enabled?: boolean } = {}) {
  return useQuery<MyReviewRead[]>({
    queryKey: ["me", "reviews"],
    queryFn: () => apiFetch<MyReviewRead[]>("/me/reviews"),
    enabled: opts.enabled ?? true,
    staleTime: 10_000,
  });
}

export function useCreateReview(placeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PlaceReviewCreate) =>
      apiFetch<PlaceReviewRead>(`/places/${placeId}/reviews`, {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => invalidatePlaceReviews(qc, placeId),
  });
}

export function useUpdateReview(placeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewId,
      ...payload
    }: Partial<PlaceReviewCreate> & { reviewId: string }) =>
      apiFetch<PlaceReviewRead>(`/me/reviews/${reviewId}`, {
        method: "PATCH",
        json: payload,
      }),
    onSuccess: () => invalidatePlaceReviews(qc, placeId),
  });
}

export function useDeleteReview(placeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) =>
      apiFetch<void>(`/me/reviews/${reviewId}`, { method: "DELETE" }),
    onSuccess: () => invalidatePlaceReviews(qc, placeId),
  });
}

export function useReportReview(placeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewId,
      reason,
      detail,
      replyId,
    }: {
      reviewId: string;
      reason: ReviewReportReason;
      detail?: string;
      replyId?: string;
    }) =>
      apiFetch<unknown>(`/places/reviews/${reviewId}/report`, {
        method: "POST",
        json: { reason, detail, reply_id: replyId },
      }),
    onSuccess: () => invalidatePlaceReviews(qc, placeId),
  });
}

export type PlaceSearchResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country_code: string | null;
  /** Curated cuisine tags. Empty array = untagged (the place still
   * appears in unfiltered searches; only drops out when the consumer
   * is filtering on cuisine and this place doesn't match). */
  cuisine_types: Cuisine[];
  /** Hero photo URL for the result-card thumbnail. Null when the
   * place has no owner-set hero (or no photos at all). The result
   * card renders a placeholder in that case. */
  hero_photo_url: string | null;
  /** Embedded halal profile — null when the place has no approved
   * claim or the profile was revoked. The search result row renders
   * a "no halal profile yet" affordance in that case. */
  halal_profile: HalalProfileEmbed | null;
  /** Google star rating (1.0–5.0) + number of ratings. Null until
   * synced. Optional so cached payloads and fixtures stay valid. */
  google_rating?: number | null;
  google_rating_count?: number | null;
  /** Trust Halal's own rating. Never blend this with google_rating — they
   *  measure different things over different populations, and every surface
   *  showing either must say which it is. */
  review_rating_avg?: number | null;
  review_count?: number;
  /** Computed open/closed from stored hours + place tz. Null when
   * hours are unknown. */
  open_now?: boolean | null;
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
  /** Curated cuisine tags. See PlaceSearchResult.cuisine_types. */
  cuisine_types: Cuisine[];
  updated_at: string | null;
  halal_profile: HalalProfileEmbed | null;
  /** Owner + consumer uploaded photos, hero-first then newest-first.
   * Empty array when no photos uploaded yet. */
  photos: PlacePhotoRead[];
  /** Convenience shortcut: the URL of the photo with is_hero=true,
   * or null when no hero is set. */
  hero_photo_url: string | null;
  /** Whether anyone can reply to reviews here. False means no verified
   *  owner exists yet, which turns the reviews block into a claim prompt. */
  is_claimed?: boolean;
  /** Listing website (from Google ingest). Null when unknown. */
  website_url?: string | null;
  /** Google star rating (1.0–5.0) + count, and when the volatile
   * Google fields were last refreshed (for a "from Google" line). */
  google_rating?: number | null;
  google_rating_count?: number | null;
  /** Trust Halal's own rating. Never blend this with google_rating — they
   *  measure different things over different populations, and every surface
   *  showing either must say which it is. */
  review_rating_avg?: number | null;
  review_count?: number;
  google_synced_at?: string | null;
  /** Human-readable weekly hours, Monday-first, e.g.
   * ["Monday: 11 AM – 11 PM", …]. Null when Google has no hours. */
  opening_hours_weekday_text?: string[] | null;
  /** Computed open/closed from stored hours + place tz. */
  open_now?: boolean | null;
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
  /** Multi-value cuisine filter. Server returns places matching ANY
   *  of the cuisines (overlap). Empty / missing = no cuisine filter. */
  cuisines?: Cuisine[];
  /** Keep only places we can confirm are NOT closed right now (server-
   *  computed against each place's hours + timezone). Unknown-hours
   *  places still come back, badged "No hours" client-side. */
  open_now?: boolean;
  /**
   * UI-only flag (never sent to the API — see useSearchPlaces): the
   * user has taken manual control of the filters on the search page,
   * so saved preferences must NOT auto-fill the empty axes. Without
   * this, clearing a preference-derived filter would just get
   * re-applied from the saved prefs on the next render.
   */
  pref_override?: boolean;
};

/**
 * Consumer-facing surfaces (favorites, disputes, search preferences,
 * saved places) treat VERIFIERS as consumers-plus: a verifier browses,
 * saves, and reports on the diner surface exactly like a consumer.
 * Only OWNER / ADMIN are the "wrong audience" on these surfaces.
 */
export function isConsumerAudience(
  role: string | null | undefined,
): boolean {
  return role === "CONSUMER" || role === "VERIFIER";
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const qk = {
  me: () => ["me"] as const,
  placesSearch: (params: SearchPlacesParams) =>
    ["places", "search", params] as const,
  placeDetail: (placeId: string) => ["places", "detail", placeId] as const,
  myDisputes: () => ["me", "disputes"] as const,
  myFavorites: () => ["me", "favorites"] as const,
  reverseGeocode: (lat: number, lng: number) =>
    ["places", "reverse-geocode", lat, lng] as const,
  forwardGeocode: (q: string) =>
    ["places", "forward-geocode", q] as const,
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

/**
 * One row in the consumer "Pick a city" disambiguation list. Mirrors
 * ``ForwardGeocodeMatch`` server-side. ``label`` is the display
 * string ("Atlanta, GA, USA"); the structured fields drive the
 * downstream near-me query.
 */
export type ForwardGeocodeMatch = {
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country_code: string | null;
};

export type ForwardGeocodeResults = {
  matches: ForwardGeocodeMatch[];
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

// ---------------------------------------------------------------------------
// Password reset (self-service)
// ---------------------------------------------------------------------------

export type ForgotPasswordRequest = {
  email: string;
  /** Which app's reset page the email links to. Consumer site sends
   * "consumer"; the API maps it to the configured origin. */
  audience: "consumer" | "owner" | "admin";
};
export type ForgotPasswordResponse = { ok: true; message: string };
export type ResetInfoResponse = { email: string; display_name: string | null };
export type ResetPasswordRequest = { token: string; password: string };
export type ResetPasswordResponse = { email: string };

/** POST /auth/forgot-password. Always resolves (generic success) even for
 * unknown emails — the UI shows the same "check your inbox" either way. */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (payload: ForgotPasswordRequest) =>
      apiFetch<ForgotPasswordResponse>("/auth/forgot-password", {
        method: "POST",
        json: payload,
      }),
  });
}

/** GET /auth/reset/{token} — prefetch to show whose password is being
 * reset. 400s on an invalid/expired/used token; no retry. */
export function useResetInfo(token: string | null) {
  return useQuery<ResetInfoResponse>({
    queryKey: ["auth", "reset", token],
    queryFn: () =>
      apiFetch<ResetInfoResponse>(
        `/auth/reset/${encodeURIComponent(token as string)}`,
      ),
    enabled: Boolean(token),
    retry: false,
  });
}

/** POST /auth/reset-password. On success the account is signed out
 * everywhere; the client routes to /login (no auto-login). */
export function useResetPassword() {
  return useMutation({
    mutationFn: (payload: ResetPasswordRequest) =>
      apiFetch<ResetPasswordResponse>("/auth/reset-password", {
        method: "POST",
        json: payload,
      }),
  });
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------
// Confirming an address doesn't sign anyone in or out — it only unlocks the
// surfaces that publish content about a named business (reviews, owner
// replies). See api/app/modules/auth/email_verification.py.

export type VerifyEmailRequest = { token: string };
export type VerifyEmailResponse = { email: string; already_verified: boolean };
export type ResendVerificationRequest = { audience?: "consumer" | "owner" | "admin" };
export type ResendVerificationResponse = { sent: boolean; email: string };

/** POST /auth/verify-email. Anonymous — the token is the proof, so a link
 *  opened on a phone works while the account is signed in elsewhere. */
export function useVerifyEmail() {
  return useMutation({
    mutationFn: (payload: VerifyEmailRequest) =>
      apiFetch<VerifyEmailResponse>("/auth/verify-email", {
        method: "POST",
        json: payload,
      }),
  });
}

/** POST /auth/verify-email/resend. Requires a session; the address comes
 *  from that session, never from the body. ``sent: false`` means the address
 *  was already confirmed — success, not an error. */
export function useResendVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ResendVerificationRequest = {}) =>
      apiFetch<ResendVerificationResponse>("/auth/verify-email/resend", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      // An already-verified response means our cached /me is stale.
      qc.invalidateQueries({ queryKey: qk.me() });
    },
  });
}

// ---------------------------------------------------------------------------
// Verifier application (public apply form)
// ---------------------------------------------------------------------------

/**
 * Payload for ``POST /verifier-applications``. Mirrors the server-
 * side ``VerifierApplicationCreate`` schema — see
 * ``api/app/modules/verifiers/schemas.py`` for the canonical spec.
 *
 * The endpoint is anonymous-OK: applicants can submit without a
 * Trust Halal account. Signed-in users get their user id linked
 * server-side via ``get_current_user_optional``.
 */
export type VerifierApplicationCreate = {
  applicant_email: string;
  applicant_name: string;
  motivation: string;
  background?: string | null;
  social_links?: {
    instagram?: string;
    tiktok?: string;
    youtube?: string;
    website?: string;
  } | null;
};

/** Response shape — echoes the created application row. */
export type VerifierApplicationRead = {
  id: string;
  applicant_user_id: string | null;
  applicant_email: string;
  applicant_name: string;
  motivation: string;
  background: string | null;
  social_links: Record<string, unknown> | null;
  status: string;
  submitted_at: string;
  updated_at: string;
};

/**
 * POST /verifier-applications — public verifier application submit.
 *
 * Rate-limited server-side per IP. Response echoes the created row
 * so the success pane can show submission details. No cache
 * invalidation needed — this is a leaf action from the consumer
 * side (admin sees it in their own queue).
 */
export function useApplyAsVerifier() {
  return useMutation({
    mutationFn: (payload: VerifierApplicationCreate) =>
      apiFetch<VerifierApplicationRead>("/verifier-applications", {
        method: "POST",
        json: payload,
      }),
  });
}

// ---------------------------------------------------------------------------
// Verifier portal (verifier-self endpoints)
// ---------------------------------------------------------------------------

/** Mirrors ``VerifierProfileStatus`` on the server. */
export type VerifierProfileStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

/** GET /me/verifier-profile — the signed-in verifier's own profile. */
export type VerifierProfileRead = {
  user_id: string;
  public_handle: string | null;
  bio: string | null;
  social_links: Record<string, unknown> | null;
  is_public: boolean;
  status: VerifierProfileStatus;
  joined_as_verifier_at: string;
  updated_at: string;
};

/** PATCH /me/verifier-profile payload. Every field optional. */
export type VerifierProfilePatch = {
  public_handle?: string | null;
  bio?: string | null;
  social_links?: Record<string, unknown> | null;
  is_public?: boolean | null;
};

/** Mirrors ``VisitDisclosure`` on the server. */
export type VisitDisclosure =
  | "SELF_FUNDED"
  | "MEAL_COMPED"
  | "PAID_PARTNERSHIP"
  | "OTHER_DISCLOSURE";

/** Mirrors ``VerificationVisitStatus`` on the server. */
export type VerificationVisitStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

export type VerificationVisitAttachmentRead = {
  id: string;
  visit_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  caption: string | null;
  uploaded_at: string;
};

/** Read shape for a single verification visit (verifier-self view). */
export type VerificationVisitRead = {
  id: string;
  verifier_user_id: string;
  place_id: string;
  visited_at: string;
  structured_findings: Record<string, unknown> | null;
  notes_for_admin: string | null;
  public_review_url: string | null;
  disclosure: VisitDisclosure;
  disclosure_note: string | null;
  status: VerificationVisitStatus;
  attachments: VerificationVisitAttachmentRead[];
  decided_at: string | null;
  decided_by_user_id: string | null;
  decision_note: string | null;
  submitted_at: string;
  updated_at: string;
};

/** POST /me/verification-visits payload. Findings are optional so the
 *  minimum viable submit is just place + date + disclosure + notes. */
export type VerificationVisitCreate = {
  place_id: string;
  visited_at: string;
  structured_findings?: Record<string, unknown> | null;
  notes_for_admin?: string | null;
  public_review_url?: string | null;
  disclosure?: VisitDisclosure;
  disclosure_note?: string | null;
};

const verifierQk = {
  profile: () => ["me", "verifier-profile"] as const,
  visits: () => ["me", "verification-visits"] as const,
  visit: (id: string) => ["me", "verification-visits", id] as const,
} as const;

function invalidateVerifierProfile(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: verifierQk.profile() });
}

function invalidateMyVisits(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: verifierQk.visits() });
}

/** GET /me/verifier-profile — resolves to null on 404 so the caller
 *  can render an "you don't have a verifier profile yet" state
 *  instead of an error. Any non-404 error still throws. */
export function useVerifierProfile() {
  return useQuery({
    queryKey: verifierQk.profile(),
    queryFn: async () => {
      try {
        return await apiFetch<VerifierProfileRead>("/me/verifier-profile");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 60 * 1000,
    retry: false,
  });
}

/** PATCH /me/verifier-profile. */
export function useUpdateVerifierProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: VerifierProfilePatch) =>
      apiFetch<VerifierProfileRead>("/me/verifier-profile", {
        method: "PATCH",
        json: payload,
      }),
    onSuccess: () => {
      void invalidateVerifierProfile(qc);
    },
  });
}

/** GET /me/verification-visits — signed-in verifier's own visits. */
export function useMyVerificationVisits() {
  return useQuery({
    queryKey: verifierQk.visits(),
    queryFn: () =>
      apiFetch<VerificationVisitRead[]>("/me/verification-visits"),
  });
}

/** GET /me/verification-visits/{id}. */
export function useMyVerificationVisit(id: string | undefined) {
  return useQuery({
    queryKey: verifierQk.visit(id ?? ""),
    queryFn: () =>
      apiFetch<VerificationVisitRead>(`/me/verification-visits/${id}`),
    enabled: Boolean(id),
  });
}

/** POST /me/verification-visits. */
export function useSubmitVerificationVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: VerificationVisitCreate) =>
      apiFetch<VerificationVisitRead>("/me/verification-visits", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void invalidateMyVisits(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Public verifier profile — /verifiers/{handle}
// ---------------------------------------------------------------------------

/** Slim place summary embedded in a public visit row. */
export type VerifierPublicVisitPlace = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

/** One ACCEPTED visit shown on the verifier's public page. */
export type VerifierPublicVisitSummary = {
  id: string;
  visited_at: string;
  disclosure: VisitDisclosure;
  public_review_url: string | null;
  place: VerifierPublicVisitPlace;
};

/** GET /verifiers/{handle} response — public profile + recent visits. */
export type VerifierPublicProfileDetail = {
  public_handle: string;
  bio: string | null;
  social_links: Record<string, unknown> | null;
  joined_as_verifier_at: string;
  recent_visits: VerifierPublicVisitSummary[];
  total_accepted_visits: number;
};

/** GET /verifiers/{handle} — resolves to null on 404 so the caller
 *  can render a "profile not found" state instead of throwing. */
export function usePublicVerifierProfile(handle: string | undefined) {
  return useQuery({
    queryKey: ["verifiers", "public", handle ?? ""] as const,
    queryFn: async () => {
      try {
        return await apiFetch<VerifierPublicProfileDetail>(
          `/verifiers/${handle}`,
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(handle),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** POST /me/verification-visits/{id}/withdraw. */
export function useWithdrawVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<VerificationVisitRead>(
        `/me/verification-visits/${id}/withdraw`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void invalidateMyVisits(qc);
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
          open_now: params.open_now || undefined,
          // Multi-value cuisine filter — encoded as repeated keys
          // (``?cuisine=PAKISTANI&cuisine=INDIAN``) by the array-aware
          // buildUrl in client.ts. Empty array drops the param.
          cuisine: params.cuisines,
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

/**
 * GET /places/google/forward-geocode — backs the consumer "Pick a
 * city" dialog. Disabled until the user has typed something
 * meaningful (3+ chars) so we don't burn a Google call on every
 * keystroke. Empty / no-match queries return an empty
 * matches[] — never an error.
 *
 * 5-minute staleTime because city geometry doesn't change; we want
 * to keep typing-and-backspacing through the same query in the
 * same dialog cheap.
 */
export function useForwardGeocode(query: string) {
  const trimmed = query.trim();
  const enabled = trimmed.length >= 3;
  return useQuery<ForwardGeocodeResults>({
    queryKey: qk.forwardGeocode(trimmed.toLowerCase()),
    queryFn: () =>
      apiFetch<ForwardGeocodeResults>("/places/google/forward-geocode", {
        searchParams: { q: trimmed },
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
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

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

/**
 * One row on the consumer favorites list. Mirrors ``FavoriteRead``
 * server-side. The embedded ``place`` is the same
 * ``PlaceSearchResult`` shape the public search list uses so the
 * /favorites page can drop straight into ``PlaceResultCard`` without
 * a second transform.
 */
export type FavoriteRead = {
  saved_at: string;
  place: PlaceSearchResult;
};

/**
 * GET /me/favorites — newest-first list of saved places.
 *
 * Disabled when the caller isn't signed in (the endpoint requires
 * auth and would 401). Pass ``isAuthenticated`` from
 * ``useCurrentUser`` to gate the fetch.
 */
export function useMyFavorites(opts: { enabled?: boolean } = {}) {
  return useQuery<FavoriteRead[]>({
    queryKey: qk.myFavorites(),
    queryFn: () => apiFetch<FavoriteRead[]>("/me/favorites"),
    enabled: opts.enabled !== false,
    staleTime: 30_000,
  });
}

/**
 * Convenience derived hook: is this place currently in the caller's
 * favorites? Backed by the same /me/favorites query so toggling one
 * heart re-renders every other heart instance for the same place
 * without a per-row fetch.
 *
 * Returns ``null`` when favorites haven't loaded yet — the caller
 * (the toggle button) shows a neutral state during the brief
 * fetch window so we don't flicker between "filled" and "empty".
 */
export function useIsFavorited(
  placeId: string,
  opts: { enabled?: boolean } = {},
): boolean | null {
  const q = useMyFavorites({ enabled: opts.enabled });
  if (!q.data) return null;
  return q.data.some((row) => row.place.id === placeId);
}

/**
 * POST /me/favorites/{place_id} — idempotent save.
 *
 * Optimistically flips the local TanStack cache: the heart toggles
 * to "filled" before the network call completes so the consumer
 * doesn't see a 200ms lag. On error we roll back to the previous
 * cache snapshot via ``onError``.
 *
 * The server response body carries the freshly-saved row
 * (with ``place`` embedded); we replace the optimistic placeholder
 * with the authoritative copy on ``onSuccess``.
 */
export function useAddFavorite() {
  const qc = useQueryClient();
  return useMutation<
    FavoriteRead,
    ApiError,
    { place: PlaceSearchResult }
  >({
    mutationFn: ({ place }) =>
      apiFetch<FavoriteRead>(`/me/favorites/${place.id}`, {
        method: "POST",
      }),
    onMutate: async ({ place }) => {
      await qc.cancelQueries({ queryKey: qk.myFavorites() });
      const previous = qc.getQueryData<FavoriteRead[]>(qk.myFavorites());
      // If we already have a list cached, prepend an optimistic row.
      // Otherwise leave cache alone — onSuccess will populate it.
      if (previous) {
        const already = previous.some((r) => r.place.id === place.id);
        if (!already) {
          qc.setQueryData<FavoriteRead[]>(qk.myFavorites(), [
            { saved_at: new Date().toISOString(), place },
            ...previous,
          ]);
        }
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      const snapshot = ctx as { previous?: FavoriteRead[] } | undefined;
      if (snapshot?.previous) {
        qc.setQueryData(qk.myFavorites(), snapshot.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.myFavorites() });
    },
  });
}

/**
 * DELETE /me/favorites/{place_id} — idempotent unsave.
 *
 * Same optimistic-update + rollback pattern as ``useAddFavorite``.
 * Server returns 204 (no body) on success, so the mutation result
 * type is ``void``.
 */
export function useRemoveFavorite() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { placeId: string }>({
    mutationFn: ({ placeId }) =>
      apiFetch<void>(`/me/favorites/${placeId}`, { method: "DELETE" }),
    onMutate: async ({ placeId }) => {
      await qc.cancelQueries({ queryKey: qk.myFavorites() });
      const previous = qc.getQueryData<FavoriteRead[]>(qk.myFavorites());
      if (previous) {
        qc.setQueryData<FavoriteRead[]>(
          qk.myFavorites(),
          previous.filter((r) => r.place.id !== placeId),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      const snapshot = ctx as { previous?: FavoriteRead[] } | undefined;
      if (snapshot?.previous) {
        qc.setQueryData(qk.myFavorites(), snapshot.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.myFavorites() });
    },
  });
}
