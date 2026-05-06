/**
 * Hooks + types for the consumer-preferences API.
 *
 * Kept in its own file (rather than appended to `hooks.ts`) because
 * the surface is self-contained and the local-store integration —
 * anonymous users save to localStorage via lib/preferences/local-store
 * — pulls in code that doesn't belong next to auth + search hooks.
 *
 * Server-of-record posture:
 *   * Signed-in consumer → server. Reads via GET /me/preferences,
 *     writes via PUT. TanStack Query holds the authoritative copy
 *     under qk.preferences.
 *   * Anonymous → localStorage. The hooks below detect "no signed-in
 *     user" via useCurrentUser and short-circuit to local-store,
 *     keeping the call sites identical from the page's POV.
 *   * Login/signup → ``syncLocalToServerOnLogin`` pushes the local
 *     prefs (if any) to the server then clears the local copy. Wired
 *     into the login + signup forms in apps/consumer/src/app/login
 *     and apps/consumer/src/app/signup.
 *
 * Type-via-codegen: ``components["schemas"]["ConsumerPreferencesRead"]``
 * will replace the hand types after the next codegen pass. Mirror of
 * the Pydantic schema in api/app/modules/consumer_preferences/schemas.py.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ApiError, apiFetch } from "./client";
import type {
  MenuPosture,
  ValidationTier,
} from "./hooks";
import {
  clearLocal,
  hasAnyFilter,
  readLocal,
  writeLocal,
} from "@/lib/preferences/local-store";

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * Mirror of ``ConsumerPreferencesRead`` server-side. Everything is
 * tri-state: NULL = "no preference," explicit value = "respect this."
 *
 * ``updated_at`` is null when the user has never saved anything (or
 * when an anonymous user has never written to local storage).
 */
export type ConsumerPreferences = {
  min_validation_tier: ValidationTier | null;
  min_menu_posture: MenuPosture | null;
  no_pork: boolean | null;
  no_alcohol_served: boolean | null;
  has_certification: boolean | null;
  updated_at: string | null;
};

/**
 * Mirror of ``ConsumerPreferencesUpdate`` — same shape minus
 * ``updated_at``. Sending ``{}`` is the canonical 'reset all' op.
 */
export type ConsumerPreferencesUpdate = Omit<ConsumerPreferences, "updated_at">;

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

// Single key for the prefs surface — there's only ever one row per
// caller, so a constant key is fine.
export const PREFERENCES_QK = ["me", "preferences"] as const;

// ---------------------------------------------------------------------------
// Server-side hooks (used when a consumer is signed in)
// ---------------------------------------------------------------------------

/**
 * Read the caller's saved preferences. Server-of-record when signed
 * in; falls back to ``readLocal()`` when ``isAuthenticated`` is
 * false. The hook always returns a defined ``data`` once resolved
 * — there's no "no preferences saved yet" null state to branch on.
 *
 * Pass ``isAuthenticated`` from the call site (which already
 * knows). We avoid pulling ``useCurrentUser`` directly here to keep
 * the dependency graph one-way: prefs depends on auth, not the
 * other way around.
 */
export function useMyPreferences(opts: { isAuthenticated: boolean }) {
  return useQuery<ConsumerPreferences>({
    queryKey: [...PREFERENCES_QK, opts.isAuthenticated ? "server" : "local"],
    queryFn: async () => {
      if (!opts.isAuthenticated) return readLocal();
      try {
        return await apiFetch<ConsumerPreferences>("/me/preferences");
      } catch (err) {
        // Owner / admin / verifier accounts get a 403 from the server
        // — they don't have a consumer-prefs row by design. Resolve to
        // empty rather than blow up the page; the prefs surface is
        // hidden for those roles anyway.
        if (err instanceof ApiError && err.status === 403) {
          return EMPTY_PREFERENCES;
        }
        throw err;
      }
    },
    // Preferences barely change — long staleTime keeps the search
    // page from re-fetching on every navigation back.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Save preferences. For authenticated callers, PUT to the server and
 * invalidate the cached read. For anonymous callers, write to
 * localStorage and prime the query cache so other consumers of the
 * hook see the new value without a re-render gap.
 */
export function useUpdatePreferences(opts: { isAuthenticated: boolean }) {
  const qc = useQueryClient();
  return useMutation<
    ConsumerPreferences,
    ApiError,
    ConsumerPreferencesUpdate
  >({
    mutationFn: async (payload) => {
      if (!opts.isAuthenticated) {
        const next: ConsumerPreferences = {
          ...payload,
          updated_at: new Date().toISOString(),
        };
        writeLocal(next);
        return next;
      }
      return apiFetch<ConsumerPreferences>("/me/preferences", {
        method: "PUT",
        json: payload,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PREFERENCES_QK });
    },
  });
}

// ---------------------------------------------------------------------------
// Login / signup sync helper
// ---------------------------------------------------------------------------

/**
 * Push the local preferences (if any) to the server, then clear the
 * local copy. Called from the login/signup pages right after auth
 * succeeds and BEFORE invalidating /me — that way the user's first
 * GET /me/preferences after sign-in already returns their migrated
 * filters.
 *
 * Best-effort: a server failure is logged via the caller's friendly
 * error handler but doesn't block the sign-in flow. The local copy
 * is preserved on failure so the user can retry by visiting the
 * preferences page.
 */
export async function syncLocalToServerOnLogin(): Promise<{
  pushed: boolean;
  error?: ApiError;
}> {
  const local = readLocal();
  if (!hasAnyFilter(local)) return { pushed: false };

  try {
    const payload: ConsumerPreferencesUpdate = {
      min_validation_tier: local.min_validation_tier,
      min_menu_posture: local.min_menu_posture,
      no_pork: local.no_pork,
      no_alcohol_served: local.no_alcohol_served,
      has_certification: local.has_certification,
    };
    await apiFetch<ConsumerPreferences>("/me/preferences", {
      method: "PUT",
      json: payload,
    });
    clearLocal();
    return { pushed: true };
  } catch (err) {
    if (err instanceof ApiError) {
      return { pushed: false, error: err };
    }
    return {
      pushed: false,
      error: new ApiError(0, "NETWORK_ERROR", String(err)),
    };
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMPTY_PREFERENCES: ConsumerPreferences = {
  min_validation_tier: null,
  min_menu_posture: null,
  no_pork: null,
  no_alcohol_served: null,
  has_certification: null,
  updated_at: null,
};
