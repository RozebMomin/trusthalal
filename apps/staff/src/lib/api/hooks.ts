import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "./client";
import type {
  GoogleAutocompletePrediction,
  HalalClaimAdminRead,
  HalalClaimApprove,
  HalalClaimReject,
  HalalClaimRequestInfo,
  HalalClaimStatus,
  AdminPhotoQueueResponse,
  AdminPhotoReportDetail,
  AdminPhotoReportRow,
  AdminReportDetailResponse,
  AdminReportQueueResponse,
  AdminReportQueueRow,
  AdminResolvePhotoReport,
  AdminResolveReportRequest,
  ConsumerDisputeAdminRead,
  DisputeResolve,
  OrganizationAdminRead,
  OwnershipRequestAdminRead,
  SupplierAdminRead,
  SupplierDetailRead,
  UserAdminPatch,
  UserAdminRead,
  PlaceBulkImportResponse,
  PlaceBulkPreviewResponse,
  PlaceIngestResponse,
  VerificationVisitDecision,
  VerificationVisitRead,
  VerifierApplicationDecision,
  VerifierApplicationRead,
  VerifierApplicationStatus,
} from "./types";

/** Append defined params as a query string. */
export function withParams(
  path: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

// ---- Halal claims --------------------------------------------------------

export function useHalalClaims(status?: HalalClaimStatus | "ALL") {
  return useQuery<HalalClaimAdminRead[]>({
    queryKey: ["halal-claims", "list", status ?? "PENDING_REVIEW"],
    queryFn: () =>
      apiFetch<HalalClaimAdminRead[]>(
        withParams("/admin/halal-claims", {
          status: status && status !== "ALL" ? status : undefined,
          limit: 200,
        }),
      ),
  });
}

export function useHalalClaim(id: string | null | undefined) {
  return useQuery<HalalClaimAdminRead>({
    queryKey: ["halal-claims", "detail", id ?? "__nil__"],
    queryFn: () => apiFetch<HalalClaimAdminRead>(`/admin/halal-claims/${id}`),
    enabled: typeof id === "string" && id.length > 0,
  });
}

function useClaimMutation<TPayload>(action: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: TPayload }) =>
      apiFetch<HalalClaimAdminRead>(
        `/admin/halal-claims/${args.id}/${action}`,
        { method: "POST", body: JSON.stringify(args.payload) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["halal-claims"] });
    },
  });
}

export const useApproveClaim = () => useClaimMutation<HalalClaimApprove>("approve");
export const useRejectClaim = () => useClaimMutation<HalalClaimReject>("reject");
export const useRequestInfoClaim = () =>
  useClaimMutation<HalalClaimRequestInfo>("request-info");

// ---- Places (add + bulk add) --------------------------------------------

/** Google Places autocomplete proxy. Enabled once the query is long enough. */
export function usePlaceAutocomplete(q: string) {
  const query = q.trim();
  return useQuery<GoogleAutocompletePrediction[]>({
    queryKey: ["places", "autocomplete", query],
    queryFn: () =>
      apiFetch<GoogleAutocompletePrediction[]>(
        withParams("/places/google/autocomplete", { q: query }),
      ),
    enabled: query.length >= 3,
    staleTime: 60_000,
  });
}

export function useIngestPlace() {
  return useMutation({
    mutationFn: (googlePlaceId: string) =>
      apiFetch<PlaceIngestResponse>("/admin/places/ingest", {
        method: "POST",
        body: JSON.stringify({ google_place_id: googlePlaceId }),
      }),
  });
}

export function useBulkPreviewPlaces() {
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<PlaceBulkPreviewResponse>("/admin/places/bulk/preview", {
        method: "POST",
        body: JSON.stringify({ google_place_ids: ids }),
      }),
  });
}

export function useBulkImportPlaces() {
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<PlaceBulkImportResponse>("/admin/places/bulk/import", {
        method: "POST",
        body: JSON.stringify({ google_place_ids: ids }),
      }),
  });
}

// ---- Verifier applications -----------------------------------------------

export function useVerifierApplications(status?: VerifierApplicationStatus | "ALL") {
  return useQuery<VerifierApplicationRead[]>({
    queryKey: ["verifier-applications", "list", status ?? "PENDING"],
    queryFn: () =>
      apiFetch<VerifierApplicationRead[]>(
        withParams("/admin/verifier-applications", {
          status: status && status !== "ALL" ? status : undefined,
          limit: 200,
        }),
      ),
  });
}

export function useDecideVerifierApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: VerifierApplicationDecision }) =>
      apiFetch<VerifierApplicationRead>(
        `/admin/verifier-applications/${args.id}/decide`,
        { method: "POST", body: JSON.stringify(args.payload) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verifier-applications"] });
    },
  });
}

// ---- Ownership requests --------------------------------------------------

export function useOwnershipRequests(status?: string) {
  return useQuery<OwnershipRequestAdminRead[]>({
    queryKey: ["ownership-requests", "list", status ?? "OPEN"],
    queryFn: () =>
      apiFetch<OwnershipRequestAdminRead[]>(
        withParams("/admin/ownership-requests", { status, limit: 200 }),
      ),
  });
}

function useOwnershipMutation<TPayload>(action: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: TPayload }) =>
      apiFetch<OwnershipRequestAdminRead>(
        `/admin/ownership-requests/${args.id}/${action}`,
        { method: "POST", body: JSON.stringify(args.payload) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ownership-requests"] });
    },
  });
}

export const useApproveOwnershipRequest = () =>
  useOwnershipMutation<{ note?: string | null }>("approve");
export const useRejectOwnershipRequest = () =>
  useOwnershipMutation<{ reason: string }>("reject");
export const useRequestOwnershipEvidence = () =>
  useOwnershipMutation<{ note: string }>("request-evidence");

// ---- Disputes ------------------------------------------------------------

export function useDisputes(status?: string) {
  return useQuery<ConsumerDisputeAdminRead[]>({
    queryKey: ["disputes", "list", status ?? "ALL"],
    queryFn: () =>
      apiFetch<ConsumerDisputeAdminRead[]>(
        withParams("/admin/disputes", { status, limit: 200 }),
      ),
  });
}

export function useDispute(id: string | null | undefined) {
  return useQuery<ConsumerDisputeAdminRead>({
    queryKey: ["disputes", "detail", id ?? "__nil__"],
    queryFn: () => apiFetch<ConsumerDisputeAdminRead>(`/admin/disputes/${id}`),
    enabled: typeof id === "string" && id.length > 0,
  });
}

export function useResolveDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: DisputeResolve }) =>
      apiFetch<ConsumerDisputeAdminRead>(`/admin/disputes/${args.id}/resolve`, {
        method: "POST",
        body: JSON.stringify(args.payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["disputes"] });
    },
  });
}

export function useRequestOwnerReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; note?: string | null }) =>
      apiFetch<ConsumerDisputeAdminRead>(
        `/admin/disputes/${args.id}/request-owner-reconciliation`,
        { method: "POST", body: JSON.stringify({ admin_decision_note: args.note ?? null }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["disputes"] });
    },
  });
}

// ---- Verification visits -------------------------------------------------

export function useVerificationVisits(status?: string) {
  return useQuery<VerificationVisitRead[]>({
    queryKey: ["verification-visits", "list", status ?? "ALL"],
    queryFn: () =>
      apiFetch<VerificationVisitRead[]>(
        withParams("/admin/verification-visits", { status, limit: 200 }),
      ),
  });
}

export function useVerificationVisit(id: string | null | undefined) {
  return useQuery<VerificationVisitRead>({
    queryKey: ["verification-visits", "detail", id ?? "__nil__"],
    queryFn: () =>
      apiFetch<VerificationVisitRead>(`/admin/verification-visits/${id}`),
    enabled: typeof id === "string" && id.length > 0,
  });
}

export function useDecideVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: VerificationVisitDecision }) =>
      apiFetch<VerificationVisitRead>(
        `/admin/verification-visits/${args.id}/decide`,
        { method: "POST", body: JSON.stringify(args.payload) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verification-visits"] });
    },
  });
}

export function useVisitUnderReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<VerificationVisitRead>(
        `/admin/verification-visits/${id}/under-review`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verification-visits"] });
    },
  });
}

// ---- Reported reviews ----------------------------------------------------

export function useReviewReports(status?: string) {
  return useQuery<AdminReportQueueRow[]>({
    queryKey: ["review-reports", "list", status ?? "OPEN"],
    queryFn: async () => {
      const res = await apiFetch<AdminReportQueueResponse>(
        withParams("/admin/review-reports", { status, limit: 200 }),
      );
      return res.items;
    },
  });
}

export function useReviewReport(reviewId: string | null | undefined) {
  return useQuery<AdminReportDetailResponse>({
    queryKey: ["review-reports", "detail", reviewId ?? "__nil__"],
    queryFn: () =>
      apiFetch<AdminReportDetailResponse>(`/admin/review-reports/${reviewId}`),
    enabled: typeof reviewId === "string" && reviewId.length > 0,
  });
}

export function useResolveReviewReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { reviewId: string; payload: AdminResolveReportRequest }) =>
      apiFetch<AdminReportDetailResponse>(
        `/admin/review-reports/${args.reviewId}/resolve`,
        { method: "POST", body: JSON.stringify(args.payload) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["review-reports"] });
    },
  });
}

// ---- Reported photos -----------------------------------------------------

export function usePhotoReports(status?: string) {
  return useQuery<AdminPhotoReportRow[]>({
    queryKey: ["photo-reports", "list", status ?? "OPEN"],
    queryFn: async () => {
      const res = await apiFetch<AdminPhotoQueueResponse>(
        withParams("/admin/photo-reports", { status, limit: 200 }),
      );
      return res.items;
    },
  });
}

export function usePhotoReport(photoId: string | null | undefined) {
  return useQuery<AdminPhotoReportDetail>({
    queryKey: ["photo-reports", "detail", photoId ?? "__nil__"],
    queryFn: () =>
      apiFetch<AdminPhotoReportDetail>(`/admin/photo-reports/${photoId}`),
    enabled: typeof photoId === "string" && photoId.length > 0,
  });
}

export function useResolvePhotoReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { photoId: string; payload: AdminResolvePhotoReport }) =>
      apiFetch<AdminPhotoReportDetail>(
        `/admin/photo-reports/${args.photoId}/resolve`,
        { method: "POST", body: JSON.stringify(args.payload) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["photo-reports"] });
    },
  });
}

// ---- Users ---------------------------------------------------------------

export function useUsers(q?: string) {
  return useQuery<UserAdminRead[]>({
    queryKey: ["users", "list", q ?? ""],
    queryFn: () =>
      apiFetch<UserAdminRead[]>(withParams("/admin/users", { q, limit: 200 })),
  });
}

export function usePatchUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: UserAdminPatch }) =>
      apiFetch<UserAdminRead>(`/admin/users/${args.id}`, {
        method: "PATCH",
        body: JSON.stringify(args.payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

// ---- Organizations -------------------------------------------------------

export function useOrganizations(status?: string) {
  return useQuery<OrganizationAdminRead[]>({
    queryKey: ["organizations", "list", status ?? "ALL"],
    queryFn: () =>
      apiFetch<OrganizationAdminRead[]>(
        withParams("/admin/organizations", { status, limit: 200 }),
      ),
  });
}

export function useOrganization(id: string | null | undefined) {
  return useQuery<OrganizationAdminRead>({
    queryKey: ["organizations", "detail", id ?? "__nil__"],
    queryFn: () => apiFetch<OrganizationAdminRead>(`/admin/organizations/${id}`),
    enabled: typeof id === "string" && id.length > 0,
  });
}

export function useVerifyOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; note: string }) =>
      apiFetch<OrganizationAdminRead>(`/admin/organizations/${args.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ note: args.note }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

export function useRejectOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; reason: string }) =>
      apiFetch<OrganizationAdminRead>(`/admin/organizations/${args.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: args.reason }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

// ---- Suppliers -----------------------------------------------------------

export function useSuppliers(includeRevoked = false) {
  return useQuery<SupplierAdminRead[]>({
    queryKey: ["suppliers", "list", includeRevoked],
    queryFn: () =>
      apiFetch<SupplierAdminRead[]>(
        withParams("/admin/suppliers", {
          include_revoked: includeRevoked ? "true" : undefined,
          limit: 200,
        }),
      ),
  });
}

export function useSupplier(id: string | null | undefined) {
  return useQuery<SupplierDetailRead>({
    queryKey: ["suppliers", "detail", id ?? "__nil__"],
    queryFn: () => apiFetch<SupplierDetailRead>(`/admin/suppliers/${id}`),
    enabled: typeof id === "string" && id.length > 0,
  });
}

export function useRevokeSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; reason?: string | null }) =>
      apiFetch<SupplierDetailRead>(`/admin/suppliers/${args.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: args.reason ?? null }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}

export function useRestoreSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<SupplierDetailRead>(`/admin/suppliers/${id}/restore`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
}
