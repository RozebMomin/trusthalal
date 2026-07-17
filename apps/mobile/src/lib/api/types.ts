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
   *  Optional so fixtures and older cached payloads stay valid. */
  google_rating?: number | null;
  google_rating_count?: number | null;
  /** Computed open/closed from stored hours + place tz. Null when unknown. */
  open_now?: boolean | null;
};

export type PlacePhoto = {
  id: string;
  url: string;
  caption: string | null;
  is_hero: boolean;
  /** OWNER | CONSUMER | VERIFIER — drives the credit line in the viewer. */
  source: string;
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

export type FavoriteRead = { saved_at: string; place: PlaceSearchResult };

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
