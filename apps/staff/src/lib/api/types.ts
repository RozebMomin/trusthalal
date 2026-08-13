// Hand-written types mirroring the API. When codegen is wired for this app
// (openapi-typescript), these can be replaced by generated schema types.

export type UserRole = "CONSUMER" | "OWNER" | "ADMIN" | "VERIFIER";

export type MobileUser = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  email_verified?: boolean;
};

export type MobileAuthResponse = {
  user: MobileUser;
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
};

export type MeRead = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
};

// ---- Halal claims --------------------------------------------------------

export type HalalClaimStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "NEEDS_MORE_INFO"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED"
  | "SUPERSEDED";

export type HalalClaimType = "INITIAL" | "RENEWAL" | "RECONCILIATION";

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

export type SlaughterMethod = "HAND_CUT" | "MACHINE_CUT" | "NOT_SERVED";

export type MeatType =
  | "CHICKEN"
  | "BEEF"
  | "LAMB"
  | "GOAT"
  | "TURKEY"
  | "DUCK"
  | "FISH"
  | "OTHER";

export type MeatProductSourcing = {
  meat_type: MeatType;
  product_name: string;
  slaughter_method: SlaughterMethod;
  supplier_name?: string | null;
  supplier_city?: string | null;
  supplier_state?: string | null;
  certifying_authority?: string | null;
  certificate_number?: string | null;
};

export type HalalQuestionnaireDraft = {
  questionnaire_version?: number;
  menu_posture?: MenuPosture | null;
  has_pork?: boolean | null;
  alcohol_policy?: AlcoholPolicy | null;
  alcohol_in_cooking?: boolean | null;
  meat_products?: MeatProductSourcing[];
  seafood_only?: boolean | null;
  has_certification?: boolean | null;
  certifying_body_name?: string | null;
  caveats?: string | null;
};

export type HalalClaimAttachmentType =
  | "HALAL_CERTIFICATE"
  | "SUPPLIER_LETTER"
  | "INVOICE"
  | "PHOTO"
  | "OTHER";

export type HalalClaimAttachmentRead = {
  id: string;
  claim_id: string;
  document_type: HalalClaimAttachmentType;
  issuing_authority: string | null;
  certificate_number: string | null;
  valid_until: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export type HalalClaimPlaceSummary = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
};

export type HalalClaimOrgSummary = { id: string; name: string };

export type HalalClaimAdminRead = {
  id: string;
  place_id: string;
  organization_id: string | null;
  place: HalalClaimPlaceSummary | null;
  organization: HalalClaimOrgSummary | null;
  claim_type: HalalClaimType;
  status: HalalClaimStatus;
  structured_response: HalalQuestionnaireDraft | null;
  attachments: HalalClaimAttachmentRead[];
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  submitted_by_user_id: string | null;
  decided_by_user_id: string | null;
  triggered_by_dispute_id: string | null;
  internal_notes: string | null;
};

export type HalalClaimApprove = {
  validation_tier: ValidationTier;
  decision_note?: string | null;
  internal_notes?: string | null;
  expires_at_override?: string | null;
  certificate_expires_at?: string | null;
  override_acknowledged?: boolean;
};

export type HalalClaimReject = {
  decision_note: string;
  internal_notes?: string | null;
};

export type HalalClaimRequestInfo = {
  decision_note: string;
  internal_notes?: string | null;
};

export const HALAL_CLAIM_OPEN_STATUSES: ReadonlyArray<HalalClaimStatus> = [
  "PENDING_REVIEW",
  "NEEDS_MORE_INFO",
];

// ---- Places (add + bulk add) --------------------------------------------

export type PlaceAdminRead = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
};

export type GoogleAutocompletePrediction = {
  google_place_id: string;
  description: string;
  primary_text: string | null;
  secondary_text: string | null;
};

export type PlaceIngestResponse = {
  place: PlaceAdminRead;
  existed: boolean;
  was_deleted: boolean;
};

export type PlaceBulkPreviewStatus = "NEW" | "EXISTS" | "SOFT_DELETED";
export type PlaceBulkPreviewItem = {
  google_place_id: string;
  status: PlaceBulkPreviewStatus;
  existing_place_id?: string | null;
  existing_name?: string | null;
};
export type PlaceBulkPreviewResponse = { items: PlaceBulkPreviewItem[] };

export type PlaceBulkImportOutcome =
  | "CREATED"
  | "EXISTED"
  | "SOFT_DELETED"
  | "FAILED";
export type PlaceBulkImportItem = {
  google_place_id: string;
  outcome: PlaceBulkImportOutcome;
  place_id?: string | null;
  place_name?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};
export type PlaceBulkImportSummary = {
  created: number;
  existed: number;
  soft_deleted: number;
  failed: number;
};
export type PlaceBulkImportResponse = {
  items: PlaceBulkImportItem[];
  summary: PlaceBulkImportSummary;
};
