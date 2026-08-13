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
  PlaceBulkImportResponse,
  PlaceBulkPreviewResponse,
  PlaceIngestResponse,
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
