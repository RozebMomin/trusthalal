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
  ConsumerDisputeAdminRead,
  DisputeResolve,
  OwnershipRequestAdminRead,
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
