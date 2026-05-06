/**
 * Pure preference-matching logic.
 *
 * Given a consumer's saved preferences + a place's halal profile,
 * returns:
 *   * ``isMatch`` — did the place satisfy every filter the consumer
 *                   set? (Filters set to NULL are skipped.)
 *   * ``matched`` — labels for the filters this place DID satisfy.
 *   * ``mismatched`` — labels + reason for filters this place
 *                      DID NOT satisfy. Drives the "doesn't match
 *                      your preference because…" badge on the detail
 *                      page.
 *
 * Pure / framework-free so it's easy to unit-test in isolation and
 * can be shared between the place detail page and the search result
 * row (a future iteration may surface match info inline in the
 * search list too).
 */

import type {
  HalalProfileEmbed,
  MenuPosture,
  ValidationTier,
} from "@/lib/api/hooks";
import type { ConsumerPreferences } from "@/lib/api/preferences";

// Same orderings as the server's _VALIDATION_TIER_ORDER /
// _MENU_POSTURE_ORDER tuples (see api/app/modules/places/repo.py).
// Index 0 is the strictest; ``min_X`` means "must be at this
// strictness or higher" — i.e. at an index ≤ the threshold's
// index.
const VALIDATION_TIER_ORDER: ValidationTier[] = [
  "TRUST_HALAL_VERIFIED",
  "CERTIFICATE_ON_FILE",
  "SELF_ATTESTED",
];

const MENU_POSTURE_ORDER: MenuPosture[] = [
  "FULLY_HALAL",
  "MIXED_SEPARATE_KITCHENS",
  "HALAL_OPTIONS_ADVERTISED",
  "HALAL_UPON_REQUEST",
  "MIXED_SHARED_KITCHEN",
];

const VALIDATION_TIER_LABELS: Record<ValidationTier, string> = {
  SELF_ATTESTED: "owner-attested",
  CERTIFICATE_ON_FILE: "certificate on file",
  TRUST_HALAL_VERIFIED: "Trust Halal verified",
};

const MENU_POSTURE_LABELS: Record<MenuPosture, string> = {
  FULLY_HALAL: "fully halal",
  MIXED_SEPARATE_KITCHENS: "separate halal kitchen",
  HALAL_OPTIONS_ADVERTISED: "halal options on menu",
  HALAL_UPON_REQUEST: "halal upon request",
  MIXED_SHARED_KITCHEN: "halal on shared equipment",
};

export type MatchEntry = {
  /** Stable key — used as the React list key. */
  key: string;
  /** Short description of the filter this entry refers to. */
  label: string;
  /**
   * For mismatches, the reason the place falls short of the
   * preference. Empty string for matches.
   */
  reason: string;
};

export type MatchResult = {
  /** Whether every populated preference matched. False when any
   *  populated preference fails. True when prefs is all-null. */
  isMatch: boolean;
  /** True if the consumer set at least one filter — used by callers
   *  to decide whether to render the "match" UI at all. */
  hasAnyPreference: boolean;
  matched: MatchEntry[];
  mismatched: MatchEntry[];
};

const EMPTY_RESULT: MatchResult = {
  isMatch: true,
  hasAnyPreference: false,
  matched: [],
  mismatched: [],
};

export function matchProfileToPreferences(
  profile: HalalProfileEmbed | null,
  prefs: ConsumerPreferences,
): MatchResult {
  const hasAnyPreference =
    prefs.min_validation_tier !== null ||
    prefs.min_menu_posture !== null ||
    prefs.no_pork === true ||
    prefs.no_alcohol_served === true ||
    prefs.has_certification === true;

  if (!hasAnyPreference) return EMPTY_RESULT;

  // No profile at all — every populated preference is a mismatch
  // (we can't confirm anything). The caller usually shows a
  // separate "no halal profile yet" affordance, so the page can
  // suppress the mismatch list when the profile is null; but the
  // computed list is still useful for the count.
  if (profile === null) {
    const reasons: MatchEntry[] = [];
    if (prefs.min_validation_tier !== null) {
      reasons.push({
        key: "min_validation_tier",
        label: "validation tier",
        reason: "this place doesn't have a verified halal profile yet",
      });
    }
    if (prefs.min_menu_posture !== null) {
      reasons.push({
        key: "min_menu_posture",
        label: "menu posture",
        reason: "no halal information on file",
      });
    }
    if (prefs.no_pork === true) {
      reasons.push({
        key: "no_pork",
        label: "no pork",
        reason: "we can't confirm this — no halal information on file",
      });
    }
    if (prefs.no_alcohol_served === true) {
      reasons.push({
        key: "no_alcohol_served",
        label: "no alcohol",
        reason: "we can't confirm this — no halal information on file",
      });
    }
    if (prefs.has_certification === true) {
      reasons.push({
        key: "has_certification",
        label: "halal certification",
        reason: "no certification on file",
      });
    }
    return {
      isMatch: false,
      hasAnyPreference: true,
      matched: [],
      mismatched: reasons,
    };
  }

  const matched: MatchEntry[] = [];
  const mismatched: MatchEntry[] = [];

  // ---- Validation tier (threshold) ----
  if (prefs.min_validation_tier !== null) {
    const ok = atLeastAsStrict(
      profile.validation_tier,
      prefs.min_validation_tier,
      VALIDATION_TIER_ORDER,
    );
    const entry = {
      key: "min_validation_tier",
      label: `at least ${VALIDATION_TIER_LABELS[prefs.min_validation_tier]}`,
      reason: ok
        ? ""
        : `this place is ${VALIDATION_TIER_LABELS[profile.validation_tier]}`,
    };
    (ok ? matched : mismatched).push(entry);
  }

  // ---- Menu posture (threshold) ----
  if (prefs.min_menu_posture !== null) {
    const ok = atLeastAsStrict(
      profile.menu_posture,
      prefs.min_menu_posture,
      MENU_POSTURE_ORDER,
    );
    const entry = {
      key: "min_menu_posture",
      label: `at least ${MENU_POSTURE_LABELS[prefs.min_menu_posture]}`,
      reason: ok
        ? ""
        : `this place is ${MENU_POSTURE_LABELS[profile.menu_posture]}`,
    };
    (ok ? matched : mismatched).push(entry);
  }

  // ---- No pork (boolean) ----
  if (prefs.no_pork === true) {
    const ok = profile.has_pork === false;
    matched.length, mismatched.length; // no-op; helps tsc narrow
    (ok ? matched : mismatched).push({
      key: "no_pork",
      label: "no pork",
      reason: ok ? "" : "pork is served on premises",
    });
  }

  // ---- No alcohol served (boolean) ----
  if (prefs.no_alcohol_served === true) {
    const ok = profile.alcohol_policy === "NONE";
    (ok ? matched : mismatched).push({
      key: "no_alcohol_served",
      label: "no alcohol",
      reason: ok ? "" : "alcohol is served on premises",
    });
  }

  // ---- Has certification (boolean) ----
  if (prefs.has_certification === true) {
    const ok = profile.has_certification === true;
    (ok ? matched : mismatched).push({
      key: "has_certification",
      label: "halal certification on file",
      reason: ok ? "" : "no halal certification on file",
    });
  }

  return {
    isMatch: mismatched.length === 0,
    hasAnyPreference: true,
    matched,
    mismatched,
  };
}

/**
 * Return true when ``actual`` is at least as strict as ``threshold``
 * in the given strictness ordering (index 0 = strictest).
 */
function atLeastAsStrict<T>(
  actual: T,
  threshold: T,
  ordering: readonly T[],
): boolean {
  const actualIdx = ordering.indexOf(actual);
  const thresholdIdx = ordering.indexOf(threshold);
  if (actualIdx === -1 || thresholdIdx === -1) {
    // Unknown enum value — treat as matching to avoid false
    // negatives during contract drift. The server-side filter is
    // the source of truth for hard exclusion.
    return true;
  }
  return actualIdx <= thresholdIdx;
}
