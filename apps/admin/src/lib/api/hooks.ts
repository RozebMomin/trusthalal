/**
 * TanStack Query hooks for trusthalal-api endpoints.
 *
 * Every return type + payload type comes from the generated OpenAPI
 * schema (`components["schemas"]["..."]`), so contract drift between
 * the FastAPI backend and this panel is caught at compile time. When
 * the API adds / renames / reshapes a route, regenerate the schema and
 * the type checker will point you at every call site that needs a fix.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ApiError, apiFetch } from "./client";
import type { components } from "./schema";

// Shorthand aliases for the shapes we reach for most.
export type OwnershipRequestAdminRead =
  components["schemas"]["OwnershipRequestAdminRead"];
export type OwnershipRequestApprove =
  components["schemas"]["OwnershipRequestApprove"];
export type OwnershipRequestReject =
  components["schemas"]["OwnershipRequestReject"];
export type OwnershipRequestEvidence =
  components["schemas"]["OwnershipRequestEvidence"];
export type OwnershipRequestAdminCreate = 
components["schemas"]["OwnershipRequestAdminCreate"];

export type OrganizationAdminRead =
  components["schemas"]["OrganizationAdminRead"];
export type OrganizationDetailRead =
  components["schemas"]["OrganizationDetailRead"];
export type OrganizationMemberAdminRead =
  components["schemas"]["OrganizationMemberAdminRead"];

// Org create / patch / member-create types (OrganizationAdminCreate,
// OrganizationAdminPatch, MemberAdminCreate) live in the generated
// schema and stay reachable via ``components["schemas"][...]`` if any
// future admin-override surface needs them; we don't re-export them
// here because the admin panel no longer authors orgs or members.

export type UserOrganizationSummary = {
  id: string;
  name: string;
  contact_email?: string | null;
};

export type UserOrganizationMembershipRead = {
  id: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
  organization: UserOrganizationSummary;
};

export type OrganizationPlaceSummary =
  components["schemas"]["OrganizationPlaceSummary"];
export type OrganizationPlaceOwnerRead =
  components["schemas"]["OrganizationPlaceOwnerRead"];

// --- Generated from the OpenAPI schema (keep alphabetized-ish by surface) ---
export type OrganizationSummaryAdmin =
  components["schemas"]["OrganizationSummaryAdmin"];
export type PlaceAdminPatch = components["schemas"]["PlaceAdminPatch"];
export type PlaceAdminRead = components["schemas"]["PlaceAdminRead"];
export type PlaceDeleteRequest = components["schemas"]["PlaceDeleteRequest"];
export type PlaceDetail = components["schemas"]["PlaceDetail"];
export type PlaceEventRead = components["schemas"]["PlaceEventRead"];
export type PlaceIngestRequest = components["schemas"]["PlaceIngestRequest"];
export type PlaceIngestResponse = components["schemas"]["PlaceIngestResponse"];
export type PlaceLinkExternalRequest =
  components["schemas"]["PlaceLinkExternalRequest"];
export type PlaceLinkExternalResponse =
  components["schemas"]["PlaceLinkExternalResponse"];
export type PlaceOwnerAdminRead =
  components["schemas"]["PlaceOwnerAdminRead"];
export type PlaceRead = components["schemas"]["PlaceRead"];
export type PlaceRestoreRequest =
  components["schemas"]["PlaceRestoreRequest"];
export type PlaceSearchResult = components["schemas"]["PlaceSearchResult"];

export type PlaceExternalIdAdminRead =
  components["schemas"]["PlaceExternalIdAdminRead"];
export type PlaceUnlinkExternalRequest =
  components["schemas"]["PlaceUnlinkExternalRequest"];
export type PlaceResyncResponse =
  components["schemas"]["PlaceResyncResponse"];
export type PlaceOwnerRevokeRequest = 
components["schemas"]["PlaceOwnerRevokeRequest"];

// Halal-trust v2 transition: the legacy claim types
// (PlaceClaimSummary, ClaimAdminRead, ClaimDetailRead, ClaimEventRead,
// EvidenceRead, AdminClaimAction, ClaimStatus, ClaimType, ClaimScope)
// were removed alongside the schema migration. Phase 3 adds the new
// halal-claim types when the v2 router lands.

export type UserAdminRead = components["schemas"]["UserAdminRead"];
export type UserAdminCreate = components["schemas"]["UserAdminCreate"];
export type UserAdminPatch = components["schemas"]["UserAdminPatch"];
export type UserRole = components["schemas"]["UserRole"];

/**
 * Return shape of ``GET /me``. Not in the generated schema because that
 * endpoint is currently returning a plain dict, not a Pydantic model.
 * Hand-typed until the server route grows a response_model.
 */
export type MeRead = {
  id: string;
  role: UserRole;
};

/*
 * Awaiting next codegen pass — the auth project added LoginRequest +
 * LoginResponse on the server. Swap to
 * ``components["schemas"]["LoginRequest"]`` / ``LoginResponse`` after
 * ``make export-openapi && npm run codegen``.
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

/*
 * Invite / set-password shapes. Pending next codegen pass — swap to
 * ``components["schemas"]["InviteInfoResponse"]`` etc. after
 * ``make export-openapi && npm run codegen``.
 *
 * UserAdminCreateResponse extends UserAdminRead with the one-time
 * invite fields; typing it as an intersection keeps today's dialog
 * type-safe AND automatically picks up any future additions to the
 * base shape.
 */
export type UserAdminCreateResponse = UserAdminRead & {
  invite_token: string;
  invite_url: string;
  invite_expires_at: string;
};

export type InviteInfoResponse = {
  email: string;
  display_name: string | null;
};

export type SetPasswordRequest = {
  token: string;
  password: string;
};

export type SetPasswordResponse = {
  user_id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  redirect_path: string;
};

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

// Keep the sort-key literal in lock-step with the server's Query()
// pattern. A typo here would surface as a 422 from the API instead of
// a compile error, so tying it to a string-literal union catches drift
// at the callsite.
//
// ``created_at`` is intentionally absent: the Place model has no
// created_at column — the CREATED row on place_events carries that
// context instead. Default sort is ``updated_at`` (most-recently
// edited first).
export type PlacesOrderBy = "updated_at" | "name" | "city" | "country";

export const qk = {
  places: {
    list: (params: {
      q?: string;
      city?: string;
      country?: string;
      deleted?: string;
      orderBy?: PlacesOrderBy;
    }) => ["places", "list", params] as const,
    detail: (id: string) => ["places", "detail", id] as const,
    events: (id: string) => ["places", "events", id] as const,
    owners: (id: string) => ["places", "owners", id] as const,
    externalIds: (id: string) => ["places", "external-ids", id] as const,
    countries: () => ["places", "countries"] as const,
  },
  ownershipRequests: {
    list: (status?: string) =>
      ["ownership-requests", "list", { status }] as const,
    detail: (id: string) => ["ownership-requests", "detail", id] as const,
  },
  organizations: {
    list: (q?: string) => ["organizations", "list", { q }] as const,
    detail: (id: string) => ["organizations", "detail", id] as const,
  },
  userOrganizations: {
    list: (userId: string) =>
      ["users", "organizations", userId] as const,
  },
  orgPlaces: {
    list: (orgId: string) => ["organizations", "places", orgId] as const,
  },
  // ``claims`` query keys removed alongside the legacy schema. Phase 3
  // adds halalClaims keys for the v2 queue.
  users: {
    list: (params: { q?: string; role?: string; isActive?: string }) =>
      ["users", "list", params] as const,
    detail: (id: string) => ["users", "detail", id] as const,
  },
  me: () => ["me"] as const,
} as const;

// ---------------------------------------------------------------------------
// Places (admin)
// ---------------------------------------------------------------------------

/**
 * List places for the admin browse.
 *
 * - `q` filters by name/address (ILIKE on the API side).
 * - `city` filters by city (ILIKE). NULL-city rows are excluded when this
 *   is set — admin is asking "where in X are we" not "which rows are vague."
 * - `country` exact-matches ISO-2 country_code. The backend case-normalizes,
 *   but we uppercase client-side too so the query key stays stable when a
 *   caller passes "us" vs "US".
 * - `orderBy` selects the sort column. Defaults to `created_at` (newest
 *   first), matching the backend's default.
 * - `includeDeleted` toggles soft-deleted places on/off. Defaults to false.
 */
export function useAdminPlaces(
  params: {
    q?: string;
    city?: string;
    country?: string;
    orderBy?: PlacesOrderBy;
    includeDeleted?: boolean;
  } = {},
) {
  const deleted = params.includeDeleted ? "true" : "false";
  const country = params.country?.toUpperCase() || undefined;
  const orderBy = params.orderBy ?? "updated_at";
  return useQuery({
    queryKey: qk.places.list({
      q: params.q,
      city: params.city,
      country,
      orderBy,
      deleted,
    }),
    queryFn: () =>
      apiFetch<PlaceAdminRead[]>("/admin/places", {
        searchParams: {
          q: params.q,
          city: params.city,
          country,
          order_by: orderBy,
          deleted,
          limit: 200,
        },
      }),
  });
}

/**
 * Distinct ISO-2 country codes present in the catalog. Used to populate
 * the admin filter dropdown — reflects actual data, not a hardcoded list.
 * Cached generously because this is cheap to compute and rarely changes
 * during a browse session.
 */
export function useAdminPlaceCountries() {
  return useQuery({
    queryKey: qk.places.countries(),
    queryFn: () => apiFetch<string[]>("/admin/places/countries"),
    // Stable enough that a 5-minute stale window is fine — the filter
    // dropdown doesn't need to track real-time ingest activity.
    staleTime: 5 * 60 * 1000,
  });
}

/** Admin detail — includes soft-deleted places (public /places/{id} 404s for those). */
export function useAdminPlaceDetail(id: string | undefined) {
  return useQuery({
    queryKey: qk.places.detail(id ?? ""),
    queryFn: () => apiFetch<PlaceAdminRead>(`/admin/places/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdminPlaceEvents(id: string | undefined) {
  return useQuery({
    queryKey: qk.places.events(id ?? ""),
    queryFn: () => apiFetch<PlaceEventRead[]>(`/admin/places/${id}/events`),
    enabled: Boolean(id),
  });
}

/**
 * Owner organizations linked to a place (via the ``place_owners`` join).
 * Server returns ACTIVE relationships first, so the first row (if any)
 * is the primary answer to "who runs this place today".
 */
export function useAdminPlaceOwners(id: string | undefined) {
  return useQuery({
    queryKey: qk.places.owners(id ?? ""),
    queryFn: () =>
      apiFetch<PlaceOwnerAdminRead[]>(`/admin/places/${id}/owners`),
    enabled: Boolean(id),
  });
}

/**
 * Revoke an ownership link. Soft-unlink on the server (status→REVOKED),
 * so the row survives in history but the slot opens up for a fresh live
 * owner. Reason flows to the EDITED PlaceEvent message.
 */
export function useRevokePlaceOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      placeId: string;
      ownerId: string;
      reason?: string | null;
    }) => {
      // Only serialize a body when the caller supplied a non-empty reason —
      // same convention as the delete/restore/unlink-external mutations.
      const trimmed = args.reason?.trim() || null;
      const payload: PlaceOwnerRevokeRequest | undefined = trimmed
        ? { reason: trimmed }
        : undefined;
      return apiFetch<void>(
        `/admin/places/${args.placeId}/owners/${args.ownerId}`,
        { method: "DELETE", json: payload },
      );
    },
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

function invalidatePlaces(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["places"] });
}

export function usePatchPlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: PlaceAdminPatch }) =>
      apiFetch<PlaceAdminRead>(`/admin/places/${args.id}`, {
        method: "PATCH",
        json: args.payload,
      }),
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

export function useDeletePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; reason?: string | null }) => {
      // Only send a body when the caller supplied a non-empty reason —
      // keeps the wire payload tidy and matches the server's "optional
      // body" contract so existing DELETE-without-body clients are
      // unaffected.
      const trimmed = args.reason?.trim() || null;
      const payload: PlaceDeleteRequest | undefined = trimmed
        ? { reason: trimmed }
        : undefined;
      return apiFetch<void>(`/admin/places/${args.id}`, {
        method: "DELETE",
        json: payload,
      });
    },
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

export function useRestorePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; reason?: string | null }) => {
      // Only send a body when a non-empty reason is supplied. Matches the
      // server's optional-body contract so existing restore callers
      // (without a reason) keep working exactly as before.
      const trimmed = args.reason?.trim() || null;
      const payload: PlaceRestoreRequest | undefined = trimmed
        ? { reason: trimmed }
        : undefined;
      return apiFetch<void>(`/admin/places/${args.id}/restore`, {
        method: "POST",
        json: payload,
      });
    },
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

/**
 * Create-or-find a Place from a Google Place ID.
 *
 * The admin panel gets ``google_place_id`` from a browser-side Places
 * Autocomplete widget and POSTs only that ID here; the backend keeps the
 * billed Google API key server-side and does the Place Details fetch itself.
 *
 * Response shape lets the caller pick a follow-up action:
 *   - ``existed=false``                → created, navigate to the new row
 *   - ``existed=true,  was_deleted=false`` → already in catalog, navigate anyway
 *   - ``existed=true,  was_deleted=true``  → soft-deleted, offer Restore
 */
export function useIngestPlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PlaceIngestRequest) =>
      apiFetch<PlaceIngestResponse>("/admin/places/ingest", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

/**
 * Attach a Google Place ID to an existing (manually-added) Place.
 *
 * Different from ingest: this one doesn't create a Place — it augments
 * one. Used to retroactively pick up Google data for places that were in
 * the catalog before the Google ingest flow existed.
 *
 * The response's ``fields_updated`` list names the canonical columns
 * that were populated by this call; UI uses it to compose a specific
 * "Backfilled: city, country_code" toast.
 */
export function useLinkPlaceExternal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: PlaceLinkExternalRequest }) =>
      apiFetch<PlaceLinkExternalResponse>(
        `/admin/places/${args.id}/link-external`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

/** List provider links attached to a place. */
export function useAdminPlaceExternalIds(id: string | undefined) {
  return useQuery({
    queryKey: qk.places.externalIds(id ?? ""),
    queryFn: () =>
      apiFetch<PlaceExternalIdAdminRead[]>(
        `/admin/places/${id}/external-ids`,
      ),
    enabled: Boolean(id),
  });
}

/** Unlink a provider from a place. Reason flows to the audit event. */
export function useUnlinkPlaceExternal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      provider: string;
      reason?: string | null;
    }) => {
      // Same "only send a body if there's a real reason" pattern as
      // the delete/restore mutations. Keeps the wire payload clean
      // for scripted callers that don't care about reasons.
      const trimmed = args.reason?.trim() || null;
      const payload: PlaceUnlinkExternalRequest | undefined = trimmed
        ? { reason: trimmed }
        : undefined;
      return apiFetch<void>(
        `/admin/places/${args.id}/external-ids/${args.provider}`,
        { method: "DELETE", json: payload },
      );
    },
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

/** Refresh the Google snapshot for a linked place. */
export function useResyncPlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string }) =>
      apiFetch<PlaceResyncResponse>(`/admin/places/${args.id}/resync`, {
        method: "POST",
      }),
    onSuccess: () => {
      void invalidatePlaces(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Organizations (admin)
// ---------------------------------------------------------------------------

export function useAdminOrganizations(
  params: { q?: string; status?: string } = {},
) {
  return useQuery({
    queryKey: qk.organizations.list(
      [params.q, params.status].filter(Boolean).join("|") || undefined,
    ),
    queryFn: () =>
      apiFetch<OrganizationAdminRead[]>("/admin/organizations", {
        searchParams: {
          q: params.q,
          status: params.status,
          limit: 200,
        },
      }),
  });
}

export function useAdminOrganization(id: string | undefined) {
  return useQuery({
    queryKey: qk.organizations.detail(id ?? ""),
    queryFn: () =>
      apiFetch<OrganizationDetailRead>(`/admin/organizations/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Places owned by this org (via the ``place_owners`` join). Server
 * returns ACTIVE relationships first, then REVOKED history. The UI
 * decides whether to fade or hide REVOKED rows.
 */
export function useAdminOrgPlaces(orgId: string | undefined) {
  return useQuery({
    queryKey: qk.orgPlaces.list(orgId ?? ""),
    queryFn: () =>
      apiFetch<OrganizationPlaceOwnerRead[]>(
        `/admin/organizations/${orgId}/places`,
      ),
    enabled: Boolean(orgId),
  });
}

function invalidateOrganizations(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["organizations"] });
}

// Org create / edit / member-management belong to the owner portal —
// owners self-serve at /me/organizations/*. The admin panel here only
// reviews what owners submit, so the corresponding admin write hooks
// (useCreateOrganization, usePatchOrganization, useAddOrgMember,
// useRemoveOrgMember) were removed. The matching `/admin/organizations`
// write endpoints stay on the server as an emergency-override surface
// (security incidents, fraud takedowns) that staff can hit via Bruno
// or curl when the rare case arises.

/**
 * POST /admin/organizations/{id}/verify — UNDER_REVIEW → VERIFIED.
 *
 * Optional ``note`` lets the reviewer record context (e.g. "checked
 * SOS filing") on the audit row. Server enforces the org is
 * UNDER_REVIEW and 409s otherwise (ORGANIZATION_NOT_REVIEWABLE).
 */
export function useVerifyOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; note?: string | null }) =>
      apiFetch<OrganizationAdminRead>(
        `/admin/organizations/${args.id}/verify`,
        {
          method: "POST",
          json: { note: args.note ?? null },
        },
      ),
    onSuccess: () => {
      void invalidateOrganizations(qc);
    },
  });
}

/**
 * POST /admin/organizations/{id}/reject — UNDER_REVIEW → REJECTED.
 *
 * ``reason`` is required (server enforces min_length=3) and surfaces
 * to the owner on their org detail page so they know why.
 */
export function useRejectOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; reason: string }) =>
      apiFetch<OrganizationAdminRead>(
        `/admin/organizations/${args.id}/reject`,
        {
          method: "POST",
          json: { reason: args.reason },
        },
      ),
    onSuccess: () => {
      void invalidateOrganizations(qc);
    },
  });
}

/**
 * A user's org memberships, with the owning org nested inline. Used by
 * the Organizations section on the admin user detail page so admins can
 * see/manage an owner's memberships from either direction.
 */
export function useUserOrganizations(userId: string | undefined) {
  return useQuery({
    queryKey: qk.userOrganizations.list(userId ?? ""),
    queryFn: () =>
      apiFetch<UserOrganizationMembershipRead[]>(
        `/admin/users/${userId}/organizations`,
      ),
    enabled: Boolean(userId),
  });
}

// ---------------------------------------------------------------------------
// Ownership requests (admin)
// ---------------------------------------------------------------------------

export function useOwnershipRequests(params: { status?: string } = {}) {
  return useQuery({
    queryKey: qk.ownershipRequests.list(params.status),
    queryFn: () =>
      apiFetch<OwnershipRequestAdminRead[]>("/admin/ownership-requests", {
        searchParams: { status: params.status },
      }),
  });
}

function invalidateOwnershipRequests(
  qc: ReturnType<typeof useQueryClient>,
) {
  return qc.invalidateQueries({ queryKey: ["ownership-requests"] });
}

/**
 * Admin-side create for an ownership request. Different from the
 * public submit flow — admin supplies ``requester_user_id`` explicitly
 * (or null for walk-in / phone intakes) instead of it being derived
 * from the caller's auth.
 */
export function useAdminCreateOwnershipRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OwnershipRequestAdminCreate) =>
      apiFetch<OwnershipRequestAdminRead>("/admin/ownership-requests", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void invalidateOwnershipRequests(qc);
    },
  });
}

export function useApproveOwnershipRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      payload: OwnershipRequestApprove;
    }) =>
      apiFetch<OwnershipRequestAdminRead>(
        `/admin/ownership-requests/${args.id}/approve`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateOwnershipRequests(qc);
    },
  });
}

export function useRejectOwnershipRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: OwnershipRequestReject }) =>
      apiFetch<OwnershipRequestAdminRead>(
        `/admin/ownership-requests/${args.id}/reject`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateOwnershipRequests(qc);
    },
  });
}

export function useRequestEvidenceOwnershipRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: OwnershipRequestEvidence }) =>
      apiFetch<OwnershipRequestAdminRead>(
        `/admin/ownership-requests/${args.id}/request-evidence`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateOwnershipRequests(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Halal claims (admin) — Phase 6 of the halal-trust v2 rebuild
// ---------------------------------------------------------------------------
// Hand-typed shapes mirror the server-side Pydantic models in
// ``app/modules/halal_claims/schemas.py`` (read shape) and
// ``app/modules/admin/halal_claims/schemas.py`` (write shapes).
// Replace these with ``components["schemas"][...]`` after running
// ``make export-openapi && npm run codegen`` against the v2 surface.

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

export type HalalClaimAttachmentType =
  | "HALAL_CERTIFICATE"
  | "SUPPLIER_LETTER"
  | "INVOICE"
  | "PHOTO"
  | "OTHER";

/** Mirrors ``HalalClaimEventType`` in the API enum module. */
export type HalalClaimEventType =
  | "DRAFT_CREATED"
  | "SUBMITTED"
  | "ATTACHMENT_ADDED"
  | "APPROVED"
  | "REJECTED"
  | "INFO_REQUESTED"
  | "REVOKED"
  | "SUPERSEDED"
  | "EXPIRED";

/** One row from the per-claim audit timeline. */
export type HalalClaimEventRead = {
  id: string;
  claim_id: string;
  event_type: HalalClaimEventType;
  actor_user_id: string | null;
  description: string | null;
  created_at: string;
};

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

/** Per-meat sourcing — repeated across chicken/beef/lamb/goat. */
export type MeatSourcing = {
  slaughter_method: SlaughterMethod;
  supplier_name?: string | null;
  supplier_location?: string | null;
};

/**
 * The structured questionnaire shape — server stores as JSONB.
 * The DRAFT shape (every field optional) covers both saved drafts
 * AND complete responses, so admin review can render whichever the
 * owner submitted without a separate ``HalalQuestionnaireResponse``
 * type on the client side.
 */
export type HalalQuestionnaireDraft = {
  questionnaire_version?: number;
  menu_posture?: MenuPosture | null;
  has_pork?: boolean | null;
  alcohol_policy?: AlcoholPolicy | null;
  alcohol_in_cooking?: boolean | null;
  chicken?: MeatSourcing | null;
  beef?: MeatSourcing | null;
  lamb?: MeatSourcing | null;
  goat?: MeatSourcing | null;
  seafood_only?: boolean | null;
  has_certification?: boolean | null;
  certifying_body_name?: string | null;
  caveats?: string | null;
};

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

/** Place fields embedded inside the claim read shape. Slim by design. */
export type HalalClaimPlaceSummary = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
};

/** Org fields embedded inside the claim read shape. */
export type HalalClaimOrgSummary = {
  id: string;
  name: string;
};

/**
 * Admin read shape. Extends the owner-side shape with the
 * staff-only fields (submitted_by_user_id, decided_by_user_id,
 * triggered_by_dispute_id, internal_notes).
 */
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
  // Admin-only fields (the owner-side hides these for tidiness).
  submitted_by_user_id: string | null;
  decided_by_user_id: string | null;
  triggered_by_dispute_id: string | null;
  internal_notes: string | null;
};

/** POST /admin/halal-claims/{id}/approve. */
export type HalalClaimApprove = {
  validation_tier: ValidationTier;
  decision_note?: string | null;
  internal_notes?: string | null;
  /** ISO-8601. Override the default 12-month expiry if needed. */
  expires_at_override?: string | null;
  /** ISO-8601. Mirrors the cert's own expiry; metadata-only. */
  certificate_expires_at?: string | null;
};

/** POST /admin/halal-claims/{id}/reject. */
export type HalalClaimReject = {
  decision_note: string;
  internal_notes?: string | null;
};

/** POST /admin/halal-claims/{id}/request-info. */
export type HalalClaimRequestInfo = {
  decision_note: string;
  internal_notes?: string | null;
};

/** POST /admin/halal-claims/{id}/revoke. */
export type HalalClaimRevoke = {
  decision_note: string;
  internal_notes?: string | null;
};

/** Response shape for the signed-URL endpoint. Same TTL as org +
 * ownership-request signed-URL endpoints (60s). */
export type HalalClaimAdminAttachmentSignedUrl = {
  url: string;
  expires_in_seconds: number;
  original_filename: string;
  content_type: string;
};

/**
 * Statuses awaiting an admin decision. Mirrors the server-side
 * ``_DECIDABLE_STATUSES`` tuple — single source of truth for both
 * the queue's "Open" filter and the detail page's action gating.
 */
export const HALAL_CLAIM_OPEN_STATUSES: ReadonlyArray<HalalClaimStatus> = [
  "PENDING_REVIEW",
  "NEEDS_MORE_INFO",
];

// ---- Query keys ----------------------------------------------------------

export const halalClaimsQk = {
  list: (params: {
    status?: string;
    placeId?: string;
    organizationId?: string;
  }) => ["halal-claims", "list", params] as const,
  detail: (id: string) => ["halal-claims", "detail", id] as const,
  events: (id: string) => ["halal-claims", "events", id] as const,
};

function invalidateHalalClaims(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["halal-claims"] });
}

// ---- Read hooks ----------------------------------------------------------

/**
 * Halal-claim review queue. ``status`` defaults to PENDING_REVIEW on
 * the page-level filter (so admin lands on "things waiting for me"),
 * but the hook itself stays generic so callers can ask for the full
 * history when auditing a place.
 */
export function useAdminHalalClaims(
  params: {
    status?: HalalClaimStatus | string;
    placeId?: string;
    organizationId?: string;
  } = {},
) {
  return useQuery<HalalClaimAdminRead[]>({
    queryKey: halalClaimsQk.list({
      status: params.status,
      placeId: params.placeId,
      organizationId: params.organizationId,
    }),
    queryFn: () =>
      apiFetch<HalalClaimAdminRead[]>("/admin/halal-claims", {
        searchParams: {
          status: params.status,
          place_id: params.placeId,
          organization_id: params.organizationId,
          limit: 200,
        },
      }),
  });
}

export function useAdminHalalClaim(id: string | null | undefined) {
  return useQuery<HalalClaimAdminRead>({
    queryKey: halalClaimsQk.detail(id ?? "__nil__"),
    queryFn: () => apiFetch<HalalClaimAdminRead>(`/admin/halal-claims/${id}`),
    enabled: typeof id === "string" && id.length > 0,
  });
}

/**
 * GET /admin/halal-claims/{id}/events — per-claim audit timeline.
 * Admin sees the full series including system-driven events
 * (SUPERSEDED, EXPIRED). Same shape the owner sees on their portal.
 */
export function useAdminHalalClaimEvents(id: string | null | undefined) {
  return useQuery<HalalClaimEventRead[]>({
    queryKey: halalClaimsQk.events(id ?? "__nil__"),
    queryFn: () =>
      apiFetch<HalalClaimEventRead[]>(
        `/admin/halal-claims/${id}/events`,
      ),
    enabled: typeof id === "string" && id.length > 0,
  });
}

// ---- Mutations -----------------------------------------------------------

export function useApproveHalalClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: HalalClaimApprove }) =>
      apiFetch<HalalClaimAdminRead>(
        `/admin/halal-claims/${args.id}/approve`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateHalalClaims(qc);
    },
  });
}

export function useRejectHalalClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: HalalClaimReject }) =>
      apiFetch<HalalClaimAdminRead>(
        `/admin/halal-claims/${args.id}/reject`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateHalalClaims(qc);
    },
  });
}

export function useRequestInfoHalalClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: HalalClaimRequestInfo }) =>
      apiFetch<HalalClaimAdminRead>(
        `/admin/halal-claims/${args.id}/request-info`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateHalalClaims(qc);
    },
  });
}

export function useRevokeHalalClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: HalalClaimRevoke }) =>
      apiFetch<HalalClaimAdminRead>(
        `/admin/halal-claims/${args.id}/revoke`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateHalalClaims(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------

function invalidateUsers(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["users"] });
}

/**
 * Whoever the current session cookie (or local dev-login header)
 * resolves to. ``data`` is null when unauthenticated; 401s don't retry.
 *
 * Used by:
 *   * the self-demotion guard on the user edit dialog,
 *   * the login page (to redirect away when already signed in),
 *   * the nav (to show "signed in as X" + a logout button),
 *   * the top-level layout (to redirect unauthenticated users to /login).
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: qk.me(),
    queryFn: async () => {
      try {
        return await apiFetch<MeRead>("/me");
      } catch (err) {
        // 401 from /me is the signal for "not signed in" — resolve
        // to null so callers can render a login page instead of a
        // loading spinner forever. Any other error (network, 5xx)
        // re-throws so useQuery surfaces it in `error`.
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    // Don't pound /me on a 401. The cached null persists until
    // invalidateMe() fires on login/logout.
    retry: false,
  });
}

function invalidateMe(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: qk.me() });
}

/**
 * POST /auth/login. On success, the browser gets the session cookie
 * automatically via Set-Cookie; we invalidate the /me cache so the nav
 * + guards see the new user immediately.
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
 * POST /auth/logout. Idempotent server-side. Clears every React Query
 * cache entry on success because the next user's data shouldn't reuse
 * the prior user's fetched rows.
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

/**
 * GET /auth/invite/{token} — prefetch.
 *
 * Used by the /set-password landing page to render "Set your password
 * for ada@example.com" before the user submits. Does NOT burn the
 * token. Stays disabled until a token is present so the bare
 * /set-password URL doesn't fire a 400 request.
 *
 * ``retry: false`` — a 400 here means the invite is invalid, expired,
 * or already used; retrying would just burn rate budget without
 * changing the outcome. Let the page render an error state
 * immediately.
 */
export function useInviteInfo(token: string | undefined) {
  return useQuery({
    queryKey: ["auth", "invite", token ?? ""] as const,
    queryFn: () => apiFetch<InviteInfoResponse>(`/auth/invite/${token}`),
    enabled: Boolean(token),
    retry: false,
  });
}

/**
 * POST /auth/set-password.
 *
 * On success, the server sets the session cookie (same as /auth/login)
 * and returns ``redirect_path`` so the client can land the user in the
 * right place. Invalidate /me so the guarded shell picks up the newly
 * authenticated state on the destination page.
 */
export function useSetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SetPasswordRequest) =>
      apiFetch<SetPasswordResponse>("/auth/set-password", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void invalidateMe(qc);
    },
  });
}

/**
 * List users with optional filters. ``role`` and ``isActive`` are
 * stringified for the query key so switching between "Active only" /
 * "Inactive only" / "All" yields distinct cache entries.
 */
export function useAdminUsers(
  params: {
    q?: string;
    role?: UserRole;
    isActive?: boolean;
  } = {},
) {
  const isActive =
    params.isActive === undefined ? undefined : String(params.isActive);
  return useQuery({
    queryKey: qk.users.list({
      q: params.q,
      role: params.role,
      isActive,
    }),
    queryFn: () =>
      apiFetch<UserAdminRead[]>("/admin/users", {
        searchParams: {
          q: params.q,
          role: params.role,
          is_active: isActive,
          limit: 200,
        },
      }),
  });
}

export function useAdminUser(id: string | undefined) {
  return useQuery({
    queryKey: qk.users.detail(id ?? ""),
    queryFn: () => apiFetch<UserAdminRead>(`/admin/users/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UserAdminCreate) =>
      apiFetch<UserAdminCreateResponse>("/admin/users", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void invalidateUsers(qc);
    },
  });
}

export function usePatchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: UserAdminPatch }) =>
      apiFetch<UserAdminRead>(`/admin/users/${args.id}`, {
        method: "PATCH",
        json: args.payload,
      }),
    onSuccess: () => {
      void invalidateUsers(qc);
    },
  });
}
