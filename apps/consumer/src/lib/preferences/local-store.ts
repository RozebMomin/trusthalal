/**
 * Anonymous-user preference storage.
 *
 * Signed-in consumers persist preferences server-side via the
 * /me/preferences endpoint (Phase 9d). Anonymous visitors get the
 * same UX, persisted in localStorage so casual browsers can save a
 * default search posture without an account.
 *
 * On signup/login, ``readLocal()`` produces the payload that gets
 * pushed up to the server as the new account's first preferences,
 * then ``clearLocal()`` is called so the in-browser copy doesn't
 * drift from the server-of-record. See ``hooks.ts`` for the sync
 * helper that ties this together.
 *
 * Why localStorage over a cookie:
 *   * The data isn't security-sensitive — at worst a stale set of
 *     filter defaults.
 *   * No reason to ship it to the API on every request; the
 *     anonymous code path computes filters client-side.
 *   * Survives across tabs without server roundtrips.
 *
 * Why a single JSON blob under one key (rather than one key per
 * field): simpler invalidation, single localStorage write, atomic
 * read on page boot.
 */

import type {
  ConsumerPreferences,
} from "@/lib/api/preferences";

const STORAGE_KEY = "tht.consumer.preferences.v1";

/**
 * Returns the locally-saved preferences, or an all-null object when
 * nothing has been saved yet. Safe to call on the server (returns
 * the empty preferences) — no localStorage access during SSR.
 */
export function readLocal(): ConsumerPreferences {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ConsumerPreferences>;
    return {
      min_validation_tier: parsed.min_validation_tier ?? null,
      min_menu_posture: parsed.min_menu_posture ?? null,
      no_pork: parsed.no_pork ?? null,
      no_alcohol_served: parsed.no_alcohol_served ?? null,
      has_certification: parsed.has_certification ?? null,
      // updated_at is "saved" only when at least one field is non-null;
      // the prefs page uses this to differentiate "fresh visit" from
      // "you cleared everything."
      updated_at: parsed.updated_at ?? null,
    };
  } catch {
    return EMPTY;
  }
}

export function writeLocal(prefs: ConsumerPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prefs, updated_at: new Date().toISOString() }),
    );
  } catch {
    // Storage may throw under quota limits or private-mode browsers.
    // Preferences are best-effort — silently dropping the write here
    // keeps the rest of the page functional.
  }
}

export function clearLocal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see writeLocal — silently swallow.
  }
}

/**
 * True when the local prefs payload contains at least one non-null
 * filter — used by the sync flow to skip the API call when there's
 * nothing to push.
 */
export function hasAnyFilter(prefs: ConsumerPreferences): boolean {
  return (
    prefs.min_validation_tier !== null ||
    prefs.min_menu_posture !== null ||
    prefs.no_pork !== null ||
    prefs.no_alcohol_served !== null ||
    prefs.has_certification !== null
  );
}

const EMPTY: ConsumerPreferences = {
  min_validation_tier: null,
  min_menu_posture: null,
  no_pork: null,
  no_alcohol_served: null,
  has_certification: null,
  updated_at: null,
};
