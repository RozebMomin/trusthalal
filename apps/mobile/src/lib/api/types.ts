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
  dispute_state: DisputeState;
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
};

export type PlaceDetail = PlaceSearchResult & {
  is_deleted: boolean;
  photos: PlacePhoto[];
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
};

export type FavoriteRead = { saved_at: string; place: PlaceSearchResult };
