import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "./client";
import type {
  HalalClaimAdminRead,
  HalalClaimApprove,
  HalalClaimReject,
  HalalClaimRequestInfo,
  HalalClaimStatus,
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
