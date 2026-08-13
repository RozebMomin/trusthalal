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

// ---- Verifier applications -----------------------------------------------

export type VerifierApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

export type VerifierApplicationRead = {
  id: string;
  applicant_email: string;
  applicant_name: string;
  motivation: string;
  background: string | null;
  social_links: Record<string, unknown> | null;
  status: VerifierApplicationStatus;
  decided_at: string | null;
  decision_note: string | null;
  submitted_at: string;
  updated_at: string;
};

export type VerifierApplicationDecision = {
  decision: "APPROVED" | "REJECTED";
  decision_note?: string | null;
};

// ---- Ownership requests --------------------------------------------------

export type OwnershipRequestStatus =
  | "SUBMITTED"
  | "NEEDS_EVIDENCE"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export type OwnershipRequestPlaceSummary = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
};

export type OwnershipRequestOrgSummary = {
  id: string;
  name: string;
  status?: string | null;
};

export type OwnershipRequestAttachment = {
  id: string;
  original_filename: string;
  size_bytes?: number;
};

export type OwnershipRequestAdminRead = {
  id: string;
  place_id: string;
  contact_name: string;
  contact_email: string;
  message: string | null;
  decision_note: string | null;
  status: OwnershipRequestStatus | string;
  created_at: string;
  updated_at: string;
  attachments: OwnershipRequestAttachment[];
  place: OwnershipRequestPlaceSummary;
  organization: OwnershipRequestOrgSummary | null;
};

// ---- Disputes ------------------------------------------------------------

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

export type DisputeAttachment = { id: string; original_filename: string };

export type ConsumerDisputeAdminRead = {
  id: string;
  place_id: string;
  status: DisputeStatus;
  disputed_attribute: DisputedAttribute;
  description: string;
  attachments: DisputeAttachment[];
  submitted_at: string;
  decided_at: string | null;
  admin_decision_note: string | null;
  updated_at: string;
};

export type DisputeResolve = {
  decision: "RESOLVED_UPHELD" | "RESOLVED_DISMISSED";
  admin_decision_note?: string | null;
};

// ---- Verification visits -------------------------------------------------

export type VerificationVisitStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

export type VisitDisclosure =
  | "SELF_FUNDED"
  | "MEAL_COMPED"
  | "PAID_PARTNERSHIP"
  | "OTHER_DISCLOSURE";

export type VisitPlaceSummary = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
};

export type VerificationVisitAttachment = {
  id: string;
  original_filename: string;
};

export type VerificationVisitRead = {
  id: string;
  place_id: string;
  place: VisitPlaceSummary | null;
  visited_at: string;
  structured_findings: HalalQuestionnaireDraft | null;
  notes_for_admin: string | null;
  public_review_url: string | null;
  disclosure: VisitDisclosure;
  disclosure_note: string | null;
  status: VerificationVisitStatus;
  attachments: VerificationVisitAttachment[];
  decision_note: string | null;
  submitted_at: string;
  updated_at: string;
};

export type VerificationVisitDecision = {
  decision: "ACCEPTED" | "REJECTED";
  decision_note?: string | null;
};

// ---- Reported reviews ----------------------------------------------------

export type ReviewReportStatus = "OPEN" | "UPHELD" | "DISMISSED";
export type ModerationAction = "NONE" | "HIDE" | "REMOVE";

export type ReviewAuthor = { display_name: string | null };

export type AdminReportQueueRow = {
  review_id: string;
  reply_id: string | null;
  place_id: string;
  place_name: string | null;
  excerpt: string;
  rating: number;
  review_status: string;
  reasons: string[];
  report_count: number;
  open_report_count: number;
  latest_report_at: string;
  targets_reply: boolean;
};

export type AdminReportQueueResponse = {
  items: AdminReportQueueRow[];
  total: number;
  next_offset: number | null;
};

export type AdminReviewReportRead = {
  id: string;
  reason: string;
  detail: string | null;
  status: ReviewReportStatus;
  reporter_display_name: string | null;
  reporter_relationship: string | null;
  created_at: string;
  resolution_note: string | null;
};

export type AdminReportReviewSnapshot = {
  id: string;
  place_id: string;
  place_name: string | null;
  author: ReviewAuthor;
  author_account_age_days: number | null;
  author_review_count: number;
  rating: number;
  body: string;
  status: string;
  created_at: string;
};

export type AdminReportDetailResponse = {
  review: AdminReportReviewSnapshot;
  reports: AdminReviewReportRead[];
};

export type AdminResolveReportRequest = {
  decision: "UPHELD" | "DISMISSED";
  action?: ModerationAction;
  resolution_note?: string | null;
};

// ---- Reported photos -----------------------------------------------------

export type PhotoReportStatus = "OPEN" | "UPHELD" | "DISMISSED";

export type AdminPhotoReportRow = {
  photo_id: string;
  place_id: string;
  place_name: string | null;
  url: string;
  uploader_display_name: string | null;
  reasons: string[];
  report_count: number;
  open_report_count: number;
  latest_report_at: string;
  reported_by_owner: boolean;
};

export type AdminPhotoQueueResponse = {
  items: AdminPhotoReportRow[];
  total: number;
  next_offset: number | null;
};

export type AdminPhotoReportDetail = {
  photo_id: string;
  place_id: string;
  place_name: string | null;
  url: string;
  caption: string | null;
  uploader_display_name: string | null;
  is_hero: boolean;
  created_at: string;
  review_id: string | null;
  review_rating: number | null;
  review_body: string | null;
  reports: Array<Record<string, unknown>>;
};

export type AdminResolvePhotoReport = {
  decision: "UPHELD" | "DISMISSED";
  remove?: boolean;
  resolution_note?: string | null;
};
