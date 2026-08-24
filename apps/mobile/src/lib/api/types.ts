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
export type SlaughterMethod =
  | "HAND_CUT"
  | "MACHINE_CUT"
  | "UNKNOWN"
  | "NOT_SERVED"
  | "NOT_DISCLOSED";

/** Red-meat axis (beef / lamb / goat). Chicken keeps SlaughterMethod. */
export type ZabihahStatus =
  | "ZABIHAH"
  | "NOT_ZABIHAH"
  | "UNSURE"
  | "NOT_SERVED";
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
  /** True when this account has never accepted the terms, or accepted an
   *  older version. Computed server-side — the client never compares version
   *  strings. Optional because the field post-dates this type. */
  terms_acceptance_required?: boolean;
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
  // Red-meat zabihah axis — what the UI renders for beef/lamb/goat.
  beef_zabihah: ZabihahStatus | null;
  lamb_zabihah: ZabihahStatus | null;
  goat_zabihah: ZabihahStatus | null;
  /** Family / prayer amenities, each `"YES" | "ON_REQUEST" | "NO" | "UNSURE"`
   *  or null (never captured). A badge shows only for YES / ON_REQUEST — see
   *  lib/amenities.ts, which both the search card and the detail screen read
   *  so the two surfaces always agree on labels and the show/hide rule. */
  prayer_space?: string | null;
  wudu?: string | null;
  bidet?: string | null;
  baby_changing?: string | null;
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
  /** Composed slaughter method + confidence per served meat, from the supplier
   *  registry + sourcing links (falls back to the owner's self-attested value).
   *  Null on surfaces that don't compute it. */
  supplier_provenance?: SupplierProvenance[] | null;
  /** True when the profile's self-attested data came from an owner claim;
   *  false when a verifier / the community established it (no owner). */
  owner_attested?: boolean;
};

/** One served meat's composed method + confidence. Render the caveat from
 *  `confidence` + `source`; never show a `self_attested` value as confirmed,
 *  and never rank hand-cut above machine-cut. */
export type SupplierProvenance = {
  meat_type: string;
  method: "HAND_CUT" | "MACHINE_CUT" | "NOT_DISCLOSED";
  confidence: "SELF_STATED" | "DOCUMENTED" | "VERIFIED";
  source: "supplier" | "self_attested";
  supplier_id: string | null;
  supplier_name: string | null;
  as_of: string | null;
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

/** Every kind of entry the halal-history timeline can carry. Kept as a union
 *  (not a bare string) so the label/icon maps in TrustProfileSheet are checked
 *  against the real set and a new backend event type surfaces as a type error
 *  rather than silently falling through to the "activity" default. */
export type HalalHistoryEventType =
  | "PROFILE_CREATED"
  | "PROFILE_UPDATED"
  | "CLAIM_SUBMITTED"
  | "CLAIM_APPROVED"
  | "VERIFIER_VISIT"
  | "EXPIRED"
  | "REVOKED"
  | "RESTORED"
  | "DISPUTE_OPENED"
  | "DISPUTE_RESOLVED"
  | "DELISTED"
  | "RELISTED";

/** What a diner reported when opening a dispute. Public-safe labels live in
 *  TrustProfileSheet; the raw code rides on DISPUTE_* history events. */
export type DisputeCategory =
  | "PORK_SERVED"
  | "ALCOHOL_PRESENT"
  | "MENU_POSTURE_INCORRECT"
  | "SLAUGHTER_METHOD_INCORRECT"
  | "CERTIFICATION_INVALID"
  | "PLACE_CLOSED"
  | "OTHER";

/** How a dispute closed — carried on DISPUTE_RESOLVED only. */
export type DisputeOutcome = "UPHELD" | "DISMISSED" | "WITHDRAWN";

/** Why a place was removed from the platform (tombstone). Non-null on the
 *  place read means the listing is a tombstone: no profile, no photos. */
export type DelistReason =
  | "NOT_HALAL"
  | "PERMANENTLY_CLOSED"
  | "FRAUDULENT"
  | "OTHER";

export type HalalHistoryEvent = {
  event_type: HalalHistoryEventType;
  description: string | null;
  created_at: string;
  /** Who the event is attributed to — drives the avatar + "Visit by @handle"
   *  line. Optional until the API populates it. */
  actor_display_name?: string | null;
  actor_handle?: string | null;
  /** Set on DISPUTE_OPENED / DISPUTE_RESOLVED — what the concern was about. */
  dispute_category?: DisputeCategory | null;
  /** Set on DISPUTE_RESOLVED only — how it was decided. */
  dispute_outcome?: DisputeOutcome | null;
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
  /** Non-null when the place was removed FOR CAUSE — a tombstone. The read
   *  then carries a null `halal_profile` and empty `photos`; render the
   *  removal state (see app/places/[id].tsx) instead of the normal body.
   *  Optional so fixtures and older cached payloads stay valid. */
  delist_reason?: DelistReason | null;
  /** When the place was de-listed. Null unless `delist_reason` is set. */
  delisted_at?: string | null;
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
  /** Per-meat slaughter filters (RESTRICTIVE). Multi-value: repeating a param
   *  keeps places serving that meat by any of the listed methods. Only the two
   *  user-selectable values (HAND_CUT / MACHINE_CUT) are ever sent. */
  chicken_slaughter?: SlaughterMethod[];
  beef_zabihah?: ZabihahStatus[];
  lamb_zabihah?: ZabihahStatus[];
  goat_zabihah?: ZabihahStatus[];
  /** Family-amenity PRIORITY BOOST (never restrictive). Matching places rank
   *  higher; non-matches still appear. Values: PRAYER_SPACE | WUDU | BIDET |
   *  BABY_CHANGING. Deliberately excluded from the active-filter count. */
  boost_amenities?: string[];
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
  /** Standalone photos only — disjoint from `review_photos_deleted`, so the
   *  two bullets on the confirmation screen never describe the same file. */
  photos_deleted: number;
  review_photos_deleted: number;
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
  // Per-meat slaughter-method defaults (HAND_CUT / MACHINE_CUT). Null / absent
  // = no preference for that meat. Mirrors the Filters sheet's per-meat
  // multi-select.
  chicken_slaughter?: SlaughterMethod[] | null;
  beef_zabihah?: ZabihahStatus[] | null;
  lamb_zabihah?: ZabihahStatus[] | null;
  goat_zabihah?: ZabihahStatus[] | null;
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
export type VerifierMeatFinding =
  | "HAND_CUT"
  | "MACHINE_CUT"
  | "ZABIHAH"
  | "NOT_ZABIHAH"
  | "NOT_SERVED"
  | "UNSURE";
export type MeatCheckEvidence = "VERBAL" | "INVOICE" | "CERTIFICATE";
export type VerifierMeatCheck = {
  finding: VerifierMeatFinding;
  evidence: MeatCheckEvidence;
  note?: string | null;
  supplier_name?: string | null;
};

export type AmenityStatus = "YES" | "ON_REQUEST" | "NO" | "UNSURE";
export type MenuPartialScope = "MEAT_GROUP" | "SPECIFIC_ITEMS" | "ON_REQUEST";
export type MenuPartialDetail = { scope: MenuPartialScope; note?: string | null };

export type VisitObservations = {
  ordered_items: string[];
  checks: Record<string, CheckResult>;
  /** Per-meat findings, keyed by MeatType. Optional; older builds omit it. */
  meat_checks?: Record<string, VerifierMeatCheck>;
  other_meat_checks?: Array<VerifierMeatCheck & { label: string }>;
  /** Detail behind a PARTIAL 'menu fully halal' answer. */
  menu_partial?: MenuPartialDetail;
  /** Family/cleanliness amenities keyed by a stable code. */
  amenities?: Record<string, AmenityStatus>;
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
