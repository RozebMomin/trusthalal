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
export type OrganizationAdminCreate =
  components["schemas"]["OrganizationAdminCreate"];
export type MemberAdminCreate = components["schemas"]["MemberAdminCreate"];

/*
 * Awaiting next codegen pass — swap to generated schema refs when
 * ``make export-openapi && npm run codegen`` has run. Until then these
 * hand types keep ``tsc --noEmit`` green.
 */
export type OrganizationAdminPatch = {
  name?: string | null;
  contact_email?: string | null;
};

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

/**
 * `GET /admin/places/{id}/claims` is typed as `list[dict]` on the API side
 * (see app/modules/admin/places/router.py). We mirror the dict keys that
 * `get_claims_for_place` actually returns so the UI stays typesafe.
 */
export type PlaceClaimSummary = {
  id: string;
  place_id: string;
  claim_type: string;
  scope: string;
  status: string;
  expires_at: string;
  evidence_count: number;
  confidence_score: number | null;
};

export type ClaimAdminRead = components["schemas"]["ClaimAdminRead"];
export type ClaimDetailRead = components["schemas"]["ClaimDetailRead"];
/**
 * Admin event row. The generated ``components["schemas"]["ClaimEventRead"]``
 * still points at the public shape (no actor fields) until the next
 * codegen pass. Intersecting with the admin-enriched fields keeps the
 * dialog type-safe today; when codegen catches up, drop the intersection
 * and this type reduces to the plain generated alias.
 */
export type ClaimEventRead = components["schemas"]["ClaimEventRead"] & {
  actor_email: string | null;
  actor_display_name: string | null;
};
export type EvidenceRead = components["schemas"]["EvidenceRead"];
export type AdminClaimAction = components["schemas"]["AdminClaimAction"];
export type ClaimStatus = components["schemas"]["ClaimStatus"];
export type ClaimType = components["schemas"]["ClaimType"];
export type ClaimScope = components["schemas"]["ClaimScope"];

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
    claims: (id: string) => ["places", "claims", id] as const,
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
  claims: {
    list: (status?: string) => ["claims", "list", { status }] as const,
    detail: (id: string) => ["claims", "detail", id] as const,
    events: (id: string) => ["claims", "events", id] as const,
  },
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

export function useAdminPlaceClaims(id: string | undefined) {
  return useQuery({
    queryKey: qk.places.claims(id ?? ""),
    queryFn: () =>
      apiFetch<PlaceClaimSummary[]>(`/admin/places/${id}/claims`),
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

// Also refresh the per-user organizations query — adding/removing a
// member affects both sides of the relationship, and the user detail
// page needs to pick up the change.
function invalidateUserOrgs(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["users", "organizations"] });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OrganizationAdminCreate) =>
      apiFetch<OrganizationAdminRead>("/admin/organizations", {
        method: "POST",
        json: payload,
      }),
    onSuccess: () => {
      void invalidateOrganizations(qc);
    },
  });
}

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

export function usePatchOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: OrganizationAdminPatch }) =>
      apiFetch<OrganizationAdminRead>(`/admin/organizations/${args.id}`, {
        method: "PATCH",
        json: args.payload,
      }),
    onSuccess: () => {
      void invalidateOrganizations(qc);
    },
  });
}

export function useAddOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string; payload: MemberAdminCreate }) =>
      apiFetch<OrganizationMemberAdminRead>(
        `/admin/organizations/${args.orgId}/members`,
        { method: "POST", json: args.payload },
      ),
    onSuccess: () => {
      void invalidateOrganizations(qc);
      void invalidateUserOrgs(qc);
    },
  });
}

export function useRemoveOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orgId: string; userId: string }) =>
      apiFetch<OrganizationMemberAdminRead>(
        `/admin/organizations/${args.orgId}/members/${args.userId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void invalidateOrganizations(qc);
      void invalidateUserOrgs(qc);
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
// Claims (admin)
// ---------------------------------------------------------------------------

export function useAdminClaims(params: { status?: string } = {}) {
  return useQuery({
    queryKey: qk.claims.list(params.status),
    queryFn: () =>
      apiFetch<ClaimAdminRead[]>("/admin/claims", {
        searchParams: { status: params.status, limit: 200 },
      }),
  });
}

/**
 * Reuses the public /claims/{id} endpoint for evidence + base claim
 * metadata. Events are NOT read from here anymore — see
 * ``useAdminClaimEvents`` below for the actor-enriched timeline that
 * powers ClaimDetailDialog.
 */
export function useClaimDetail(id: string | undefined) {
  return useQuery({
    queryKey: qk.claims.detail(id ?? ""),
    queryFn: () => apiFetch<ClaimDetailRead>(`/claims/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Admin-only event timeline. Mirrors ``GET /admin/claims/{id}/events``
 * which LEFT-joins users so each row carries ``actor_email`` and
 * ``actor_display_name`` — needed for "who did this?" audit triage.
 *
 * We don't reuse ``useClaimDetail``'s events list because the public
 * endpoint only surfaces ``actor_user_id`` (to avoid leaking admin
 * emails to anonymous callers). Admin-only callers pay one extra
 * round-trip for the enriched shape, which is fine — the dialog
 * already fetches both in parallel.
 */
export function useAdminClaimEvents(id: string | undefined) {
  return useQuery({
    queryKey: qk.claims.events(id ?? ""),
    queryFn: () =>
      apiFetch<ClaimEventRead[]>(`/admin/claims/${id}/events`, {
        searchParams: { limit: 200 },
      }),
    enabled: Boolean(id),
  });
}

function invalidateClaims(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["claims"] });
}

export function useVerifyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: AdminClaimAction }) =>
      apiFetch(`/admin/claims/${args.id}/verify`, {
        method: "POST",
        json: args.payload,
      }),
    onSuccess: () => {
      void invalidateClaims(qc);
    },
  });
}

export function useRejectClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: AdminClaimAction }) =>
      apiFetch(`/admin/claims/${args.id}/reject`, {
        method: "POST",
        json: args.payload,
      }),
    onSuccess: () => {
      void invalidateClaims(qc);
    },
  });
}

export function useExpireClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: AdminClaimAction }) =>
      apiFetch(`/admin/claims/${args.id}/expire`, {
        method: "POST",
        json: args.payload,
      }),
    onSuccess: () => {
      void invalidateClaims(qc);
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
