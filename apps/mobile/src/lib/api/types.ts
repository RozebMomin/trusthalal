/**
 * Hand-written API types for v0. Once `npm run codegen` is wired
 * against api/openapi.json these narrow to the generated schema —
 * shapes below mirror apps/consumer/src/lib/api/hooks.ts exactly.
 */
export type UserRole = "CONSUMER" | "OWNER" | "ADMIN" | "VERIFIER";
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
export type SlaughterMethod = "ZABIHAH" | "MACHINE" | "UNKNOWN" | "NOT_SERVED";
export type AlcoholPolicy = "NONE" | "BEER_AND_WINE_ONLY" | "FULL_BAR";
export type DisputeState = "NONE" | "DISPUTED" | "RECONCILING";

export type MobileUser = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  /** Whether the account confirmed its email address. Gates posting reviews
   *  and nothing else — browsing and saving stay open. Optional because the
   *  field post-dates this type and older cached payloads won't carry it. */
  email_verified?: boolean;
};

export type MobileAuthResponse = {
  user: MobileUser;
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
};

export type HalalProfileEmbed = {
  validation_tier: ValidationTier;
  menu_posture: MenuPosture;
  chicken_slaughter: SlaughterMethod | null;
  beef_slaughter: SlaughterMethod | null;
  lamb_slaughter: SlaughterMethod | null;
  goat_slaughter: SlaughterMethod | null;
  has_pork: boolean;
  alcohol_policy: AlcoholPolicy | null;
  alcohol_in_cooking: boolean;
  seafood_only: boolean;
  has_certification: boolean;
  certifying_body_name: string | null;
  certificate_expires_at: string | null;
  certificate_url: string | null;
  certificate_content_type: string | null;
  caveats: string | null;
  last_verified_at: string;
  dispute_state: DisputeState;
  /** Per-product sourcing, as the OWNER described it.
   *
   *  `null` means this surface didn't load it — search results don't, since
   *  a card only renders the rolled-up per-meat labels. `[]` means the
   *  restaurant listed no products. Don't collapse the two: rendering
   *  "no products on file" on a search card would be a claim about the
   *  restaurant that the payload never made. */
  meat_products: MeatProduct[] | null;
};

/** One product and where the restaurant says it comes from.
 *
 *  Everything here is the owner's account of their own supply chain, not a
 *  Trust Halal finding — verifier visits record observations as free text,
 *  so nothing structurally confirms a supplier. Any UI showing
 *  `supplier_name` has to attribute it, or the restaurant's claim starts
 *  looking like our verification. */
export type MeatProduct = {
  meat_type: string;
  product_name: string;
  slaughter_method: SlaughterMethod;
  supplier_name: string | null;
  supplier_city: string | null;
  supplier_state: string | null;
  certifying_authority: string | null;
};

export type HalalHistoryEvent = {
  event_type: string;
  description: string | null;
  created_at: string;
  /** Who the event is attributed to — drives the avatar + "Visit by @handle"
   *  line. Optional until the API populates it. */
  actor_display_name?: string | null;
  actor_handle?: string | null;
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
  cuisine_types: string[];
  hero_photo_url: string | null;
  halal_profile: HalalProfileEmbed | null;
  /** Google star rating (1.0–5.0) + number of ratings. Null until synced.
   *  Optional so fixtures and older cached payloads stay valid.
   *
   *  Never render this without saying it's Google's — see RatingLine. */
  google_rating?: number | null;
  google_rating_count?: number | null;
  /** Trust Halal's own rating, from first-party reviews. Deliberately a
   *  separate pair from Google's: they measure different things over
   *  different populations and must never be blended or shown unlabelled. */
  review_rating_avg?: number | null;
  review_count?: number;
  /** Computed open/closed from stored hours + place tz. Null when unknown. */
  open_now?: boolean | null;
};

/** Display-level provenance, derived server-side.
 *
 *  Render credits from this, never from `source`. The viewer previously
 *  keyed a label map off `source` with a VERIFIER entry that was never a
 *  real value and no GOOGLE case at all — so backfilled Google photos, which
 *  exist in production, rendered a bare "photo". */
export type PhotoAttribution = "OWNER" | "DINER" | "REVIEW" | "GOOGLE";

export type PlacePhoto = {
  id: string;
  url: string;
  caption: string | null;
  is_hero: boolean;
  /** OWNER | CONSUMER | GOOGLE, as stored. Prefer `attribution`. */
  source: string;
  attribution: PhotoAttribution;
  /** Set when the photo was attached to a review, with that review's rating
   *  so the credit can say which. */
  review_id: string | null;
  review_rating: number | null;
  uploaded_by_display_name: string | null;
  width_px: number | null;
  height_px: number | null;
  created_at: string;
};

export type PlaceDetail = PlaceSearchResult & {
  is_deleted: boolean;
  phone: string | null;
  /** IANA timezone (from Google) — used to compute "today" in the
   *  place's own timezone for the weekly hours highlight. */
  timezone?: string | null;
  photos: PlacePhoto[];
  /** Listing website (from Google ingest). */
  website_url?: string | null;
  /** When the volatile Google fields (rating/hours) were last refreshed. */
  google_synced_at?: string | null;
  /** Human-readable weekly hours, Monday-first, e.g. ["Monday: 11 AM – 11 PM"]. */
  opening_hours_weekday_text?: string[] | null;
};

export type SearchPlacesParams = {
  q?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  min_validation_tier?: ValidationTier;
  min_menu_posture?: MenuPosture;
  has_certification?: boolean;
  no_pork?: boolean;
  no_alcohol_served?: boolean;
  cuisines?: string[];
  /** Keep only places we can confirm are open right now (server-computed
   *  against each place's stored hours + timezone). */
  open_now?: boolean;
};

/** One filter individually responsible for an empty result set. */
export type SearchRelaxation = {
  /** Machine key — clear exactly this one, not all of them. */
  field: string;
  count_if_removed: number;
};

/** Why a search returned nothing. Counts only, never places: someone who
 *  filtered out alcohol or non-zabihah meat isn't looking for near-misses. */
export type SearchDiagnostics = {
  total_in_area: number;
  single_filter_relaxations: SearchRelaxation[];
  without_halal_filters: number;
  without_cuisines: number;
  wider_radius_m: number | null;
  wider_radius_count: number | null;
};

/** What deleting your account would remove. Real numbers for the confirm
 *  screen — an irreversible choice deserves better than a generic warning. */
export type AccountDeletionPreview = {
  reviews_deleted: number;
  photos_deleted: number;
  keeps_owner_photos: boolean;
  keeps_owner_replies: boolean;
};

/** Someone you've blocked. Display name so the settings list is readable —
 *  a column of UUIDs would make unblocking guesswork. */
export type BlockedUser = {
  user_id: string;
  display_name: string | null;
  created_at: string;
};

export type FavoriteRead = { saved_at: string; place: PlaceSearchResult };

/** One row of the per-category, per-channel notification matrix.
 *  Everything defaults ON; false means the user opted out. Transactional
 *  categories always report email=true — they can't be silenced by email. */
export type NotificationPreference = {
  category: string;
  email: boolean;
  push: boolean;
};

export type NotificationPreferencesResponse = {
  preferences: NotificationPreference[];
};

export type NotificationChannel = "EMAIL" | "PUSH";

/** GET/PUT /me/preferences — the diner's saved search defaults.
 *  Null on any field means "no preference". ``updated_at`` is null until the
 *  first save, which is how we tell "never customized" from "turned it all
 *  off". PUT is a full replace: sending {} resets everything. */
export type ConsumerPreferences = {
  min_validation_tier?: ValidationTier | null;
  min_menu_posture?: MenuPosture | null;
  no_pork?: boolean | null;
  no_alcohol_served?: boolean | null;
  has_certification?: boolean | null;
  updated_at?: string | null;
};

// ---------------------------------------------------------------------------
// Verification visits (verifier surface)
// ---------------------------------------------------------------------------
export type VisitDisclosure =
  | "SELF_FUNDED"
  | "MEAL_COMPED"
  | "PAID_PARTNERSHIP"
  | "OTHER_DISCLOSURE";

export type VerificationVisitStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

/** Slim place summary embedded on a visit row so the list can show the
 *  restaurant name without an N+1 lookup. */
export type VisitPlace = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

export type CheckResult = "YES" | "NO" | "PARTIAL";

/** Lightweight structured observations from the observe step — kept
 *  separate from the heavy owner-style questionnaire. */
export type VisitObservations = {
  ordered_items: string[];
  checks: Record<string, CheckResult>;
};

export type VerificationVisitAttachment = {
  id: string;
  visit_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  caption: string | null;
  uploaded_at: string;
};

export type VerificationVisit = {
  id: string;
  verifier_user_id: string;
  place_id: string;
  place: VisitPlace | null;
  visited_at: string;
  observations: VisitObservations | null;
  notes_for_admin: string | null;
  public_review_url: string | null;
  disclosure: VisitDisclosure;
  disclosure_note: string | null;
  status: VerificationVisitStatus;
  attachments: VerificationVisitAttachment[];
  decided_at: string | null;
  decision_note: string | null;
  submitted_at: string;
  updated_at: string;
};

export type SubmitVisitInput = {
  place_id: string;
  visited_at: string;
  observations?: VisitObservations;
  notes_for_admin?: string;
  public_review_url?: string;
  disclosure: VisitDisclosure;
  disclosure_note?: string;
};

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** The author's own review, with enough place context to render a list.
 *  The bare read carries only `place_id`, which is unusable on a screen
 *  listing reviews across restaurants. */
export type MyReviewRead = PlaceReviewRead & {
  place: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
  } | null;
};

export type ReviewSort = "recent" | "rating_high" | "rating_low";

/** Why a review or reply is being reported.
 *
 * The report queue is the primary defence for text on this platform: the
 * content filter catches profanity, but whether a claim about a restaurant
 * is *false* is a question about the world rather than about the words, and
 * only a human can weigh it.
 */
export type ReviewReportReason =
  | "FALSE_INFO"
  | "HARASSMENT"
  | "OFF_TOPIC"
  | "SPAM"
  | "CONFLICT_OF_INTEREST"
  | "OTHER";

/** Author identity on a review. No role, deliberately — a verifier's review
 *  renders like anyone else's. Verifier standing is earned against facts and
 *  doesn't transfer to weight of opinion about a meal. */
export type ReviewAuthorRead = {
  id: string;
  display_name: string | null;
};

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
  status: "PUBLISHED" | "HIDDEN" | "REMOVED";
  edited_at: string | null;
  created_at: string;
  photos: Array<{ id: string; url: string }>;
  reply: PlaceReviewReplyRead | null;
  /** The review changed after the reply was written, so the reply may be
   *  answering text that is no longer there. Computed server-side so all
   *  clients agree — don't recompute it from the two timestamps. */
  edited_after_reply: boolean;
  is_mine: boolean;
  reported_by_me: boolean;
  moderation_note: string | null;
};

/** Both ratings ride together so each can be labelled. They measure
 *  different things over different populations and must never be blended. */
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
  /** False when signed out, unverified, or already reviewed — lets the app
   *  explain why rather than hiding the button. */
  can_review: boolean;
  my_review_id: string | null;
};

export type PlaceReviewCreate = {
  rating: number;
  body: string;
  visited_on?: string | null;
  /** Set on the second attempt, after the user has seen the "this reads
   *  heated" nudge and chosen to post anyway. Waives the soft WARN verdict
   *  only — the text is re-scored server-side and profanity still blocks. */
  acknowledged_warning?: boolean;
};
