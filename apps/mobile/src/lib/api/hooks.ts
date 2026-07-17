/**
 * React Query hooks — ported shapes from apps/consumer/src/lib/api/hooks.ts.
 * Query keys are tuples (sacred convention); apiFetch handles bearer +
 * refresh transparently.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { capture, identify, resetAnalytics } from "@/lib/analytics";
import { tokenStore } from "@/lib/auth/token-store";
import type {
  FavoriteRead,
  HalalHistoryEvent,
  MobileAuthResponse,
  MobileUser,
  PlaceDetail,
  PlaceSearchResult,
  SearchPlacesParams,
  SubmitVisitInput,
  VerificationVisit,
  VerificationVisitAttachment,
  VerificationVisitStatus,
} from "./types";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<MobileUser | null> => {
      const { access } = await tokenStore.get();
      if (!access) return null;
      try {
        return await apiFetch<MobileUser>("/me");
      } catch {
        return null;
      }
    },
  });
}

async function storeAuth(body: MobileAuthResponse) {
  await tokenStore.set({ access: body.access_token, refresh: body.refresh_token });
  return body;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiFetch<MobileAuthResponse>("/auth/mobile/login", {
        method: "POST",
        body: JSON.stringify(input),
      }).then(storeAuth),
    onSuccess: (data) => {
      identify(data.user.id, { role: data.user.role });
      capture("logged_in", { method: "password" });
      void qc.invalidateQueries();
    },
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; display_name: string }) =>
      apiFetch<MobileAuthResponse>("/auth/mobile/signup", {
        method: "POST",
        body: JSON.stringify(input),
      }).then(storeAuth),
    onSuccess: (data) => {
      identify(data.user.id, { role: data.user.role });
      capture("signed_up");
      void qc.invalidateQueries();
    },
  });
}

/** POST /auth/forgot-password with audience=consumer — the reset link
 *  opens the consumer web page. Always resolves generically (no
 *  enumeration), so the screen shows the same "check your email" either
 *  way. */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      apiFetch<{ ok: boolean; message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: input.email, audience: "consumer" }),
      }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { refresh } = await tokenStore.get();
      if (refresh) {
        await apiFetch("/auth/mobile/logout", {
          method: "POST",
          body: JSON.stringify({ refresh_token: refresh }),
        }).catch(() => undefined); // logout never fails visibly
      }
      await tokenStore.clear();
    },
    onSuccess: () => {
      capture("logged_out");
      resetAnalytics();
      void qc.invalidateQueries();
    },
  });
}

function searchParamsToQuery(p: SearchPlacesParams): string {
  const u = new URLSearchParams();
  if (p.q) u.set("q", p.q);
  if (p.lat !== undefined && p.lng !== undefined && p.radius !== undefined) {
    u.set("lat", p.lat.toFixed(5));
    u.set("lng", p.lng.toFixed(5));
    u.set("radius", String(Math.round(p.radius)));
  }
  if (p.min_validation_tier) u.set("min_validation_tier", p.min_validation_tier);
  if (p.min_menu_posture) u.set("min_menu_posture", p.min_menu_posture);
  if (p.has_certification) u.set("has_certification", "true");
  if (p.no_pork) u.set("no_pork", "true");
  if (p.no_alcohol_served) u.set("no_alcohol_served", "true");
  if (p.open_now) u.set("open_now", "true");
  for (const c of p.cuisines ?? []) u.append("cuisine", c);
  return u.toString();
}

export function useSearchPlaces(params: SearchPlacesParams) {
  const hasText = Boolean(params.q && params.q.length > 0);
  const hasGeo =
    params.lat !== undefined && params.lng !== undefined && params.radius !== undefined;
  return useQuery({
    queryKey: ["places", "search", params],
    queryFn: () =>
      apiFetch<PlaceSearchResult[]>(`/places?${searchParamsToQuery(params)}`),
    enabled: hasText || hasGeo,
  });
}

export function usePlaceDetail(id: string) {
  return useQuery({
    queryKey: ["places", "detail", id],
    queryFn: async () => {
      // UI-first mode: fixture ids render mockup content without the API.
      // Gated to dev builds — in production these `fx-` ids must never
      // resolve, or a deep link (trusthalal://places/fx-…) could render a
      // fabricated "verified" restaurant. Metro strips the branch (and the
      // fixtures import) from release bundles when __DEV__ is false.
      if (__DEV__ && id.startsWith("fx-")) {
        const { FIXTURE_PLACES } = await import("@/fixtures");
        const fx = FIXTURE_PLACES.find((x) => x.id === id);
        if (fx) return { ...fx, is_deleted: false, phone: null, photos: [] } as PlaceDetail;
      }
      // Encode the id so a crafted deep-link param can't steer the
      // authenticated request onto another API path.
      return apiFetch<PlaceDetail>(`/places/${encodeURIComponent(id)}`);
    },
    enabled: Boolean(id),
  });
}

/** Verification-history timeline for the expanded trust profile. */
export function useHalalHistory(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["places", "halal-history", id],
    queryFn: () =>
      apiFetch<HalalHistoryEvent[]>(`/places/${encodeURIComponent(id)}/halal-history`),
    enabled: enabled && Boolean(id) && !id.startsWith("fx-"),
  });
}

export function useReverseGeocode(lat?: number, lng?: number) {
  return useQuery({
    queryKey: ["geocode", "reverse", lat?.toFixed(3), lng?.toFixed(3)],
    queryFn: () =>
      apiFetch<{ city: string | null; region: string | null }>(
        `/geocode/reverse?lat=${lat}&lng=${lng}`,
      ),
    enabled: lat !== undefined && lng !== undefined,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyFavorites(enabled: boolean) {
  return useQuery({
    queryKey: ["me", "favorites"],
    queryFn: () => apiFetch<FavoriteRead[]>("/me/favorites"),
    enabled,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ placeId, saved }: { placeId: string; saved: boolean; place?: PlaceSearchResult }) =>
      saved
        ? apiFetch(`/me/favorites/${encodeURIComponent(placeId)}`, { method: "DELETE" })
        : apiFetch(`/me/favorites/${encodeURIComponent(placeId)}`, { method: "POST" }),
    // Optimistic: the heart fills the instant you tap, the list updates
    // immediately, and we roll back if the server disagrees.
    onMutate: async ({ placeId, saved, place }) => {
      capture("favorite_toggled", { place_id: placeId, place_name: place?.name ?? null, action: saved ? "removed" : "added" });
      await qc.cancelQueries({ queryKey: ["me", "favorites"] });
      const previous = qc.getQueryData<FavoriteRead[]>(["me", "favorites"]);
      qc.setQueryData<FavoriteRead[]>(["me", "favorites"], (old = []) =>
        saved
          ? old.filter((f) => f.place.id !== placeId)
          : place
            ? [{ saved_at: new Date().toISOString(), place }, ...old]
            : old,
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(["me", "favorites"], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["me", "favorites"] }),
  });
}

// ---------------------------------------------------------------------------
// Verifier applications
// ---------------------------------------------------------------------------
export type VerifierApplication = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  submitted_at: string;
  decision_note: string | null;
};

export function useMyVerifierApplications(enabled: boolean) {
  return useQuery({
    queryKey: ["me", "verifier-applications"],
    queryFn: () => apiFetch<VerifierApplication[]>("/me/verifier-applications"),
    enabled,
  });
}

export function useSubmitVerifierApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      applicant_email: string;
      applicant_name: string;
      motivation: string;
      background?: string;
      social_links?: Record<string, string>;
    }) =>
      apiFetch("/verifier-applications", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["me", "verifier-applications"] }),
  });
}

// ---------------------------------------------------------------------------
// Verification visits — the verifier's own site-visit records
// ---------------------------------------------------------------------------

/** GET /me/verification-visits — newest-first, optional status filter.
 *  VERIFIER-only on the server; gate with `enabled` on role so a
 *  demoted user doesn't fire a doomed request. */
export function useMyVerificationVisits(
  enabled: boolean,
  status?: VerificationVisitStatus,
) {
  return useQuery({
    queryKey: ["me", "verification-visits", status ?? "all"],
    queryFn: () =>
      apiFetch<VerificationVisit[]>(
        `/me/verification-visits${status ? `?status=${status}` : ""}`,
      ),
    enabled,
  });
}

/** GET /me/verification-visits/{id} — the verifier's own visit detail. */
export function useVerificationVisit(id: string | null | undefined) {
  return useQuery({
    queryKey: ["me", "verification-visits", "detail", id],
    queryFn: () =>
      apiFetch<VerificationVisit>(
        `/me/verification-visits/${encodeURIComponent(String(id))}`,
      ),
    enabled: Boolean(id),
  });
}

export function useSubmitVerificationVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitVisitInput) =>
      apiFetch<VerificationVisit>("/me/verification-visits", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (visit) => {
      capture("verification_visit_submitted", {
        place_id: visit.place_id,
        disclosure: visit.disclosure,
      });
      void qc.invalidateQueries({ queryKey: ["me", "verification-visits"] });
    },
  });
}

/** Upload one photo to a SUBMITTED visit (multipart). Used in the wizard's
 *  submit flow: create the visit, then upload each on-device photo. Not a
 *  react-query mutation — it's called in a loop and we don't cache per-file. */
export async function uploadVisitAttachment(
  visitId: string,
  photo: { uri: string; name: string; type: string; tag?: string },
): Promise<VerificationVisitAttachment> {
  const form = new FormData();
  // RN's fetch accepts this {uri,name,type} shape as a file part.
  form.append("file", {
    uri: photo.uri,
    name: photo.name,
    type: photo.type,
  } as unknown as Blob);
  if (photo.tag) form.append("caption", photo.tag);
  return apiFetch<VerificationVisitAttachment>(
    `/me/verification-visits/${encodeURIComponent(visitId)}/attachments`,
    { method: "POST", body: form },
  );
}

/** POST /me/verification-visits/{id}/withdraw — pull a SUBMITTED visit. */
export function useWithdrawVerificationVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visitId: string) =>
      apiFetch<VerificationVisit>(
        `/me/verification-visits/${encodeURIComponent(visitId)}/withdraw`,
        { method: "POST" },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["me", "verification-visits"] }),
  });
}
