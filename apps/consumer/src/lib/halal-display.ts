/**
 * Pure functions that translate a place's HalalProfileEmbed into the
 * consumer-facing copy + visual tone we want to render.
 *
 * Two concerns:
 *
 *   1. ``primaryHalalSignal(place)``  — derives ONE pill that lands at
 *      the top-right of every result card. Combines validation tier +
 *      menu posture + dispute state into a single trust statement.
 *      Returns the copy, a tone classification (positive / neutral /
 *      muted / warning), and an icon hint the card renderer can map.
 *   2. ``halalFactsFor(place)``       — returns a list of compact "fact
 *      chips" to render under the name. Only positive / specific
 *      signals — Zabihah slaughter, certification on file, no pork,
 *      no alcohol, fully halal kitchen, etc. Negative cases are
 *      conveyed by ABSENCE of the chip, never by an anti-chip.
 *
 * Why pure helpers in their own module: result cards on the search
 * page, the place detail page, and (eventually) map popovers all
 * need to render the same trust language. Centralizing the copy
 * here means a wording change is a one-line edit instead of a
 * grep-and-pray across surfaces. Tests (when they land) exercise
 * these as plain functions — no React renderer needed.
 *
 * Anything that escapes the curated copy table here lands as ``raw``
 * — defensive for forward-compat: if the API adds a new
 * MenuPosture variant we don't immediately know about, the result
 * card still renders something sane until the consumer ships an
 * update.
 */

import type {
  AlcoholPolicy,
  HalalProfileEmbed,
  MenuPosture,
  PlaceSearchResult,
  ValidationTier,
} from "@/lib/api/hooks";

/**
 * Card-level tone classification — drives the pill's color treatment.
 *
 *   * ``positive`` — verifier-confirmed halal. The strongest trust
 *     signal we can give. Olive/sage primary, the brand color.
 *   * ``trusted``  — certificate on file. Cert paper carries weight
 *     but is one step below an in-person verification. Amber accent
 *     so it reads warm and legitimate without claiming the verifier
 *     gravitas.
 *   * ``neutral``  — owner-attested. The owner says it's halal; we
 *     have no third-party validation. Honest, not glamorous.
 *   * ``muted``    — no profile yet. Place exists in the catalog but
 *     nobody has filed an approved halal claim. Distinct from
 *     "we know it's not halal" — we just don't know.
 *   * ``warning``  — disputed. Someone reported the profile may be
 *     wrong. The user should be aware before relying on the place.
 */
export type HalalSignalTone =
  | "positive"
  | "trusted"
  | "neutral"
  | "muted"
  | "warning";

export type PrimaryHalalSignal = {
  /** Short label that fits in a pill (target: <= 22 chars). */
  label: string;
  /** Color treatment for the pill — see HalalSignalTone above. */
  tone: HalalSignalTone;
  /**
   * Long-form tooltip / accessibility description. Spelled-out so
   * the consumer understands what the pill is asserting before
   * tapping into the detail page.
   */
  description: string;
};

/**
 * Compact attribute chip. ``label`` is the visible text; ``hint`` is
 * the optional title-attribute hover for desktop and the screen-
 * reader-only longer description.
 */
export type HalalFactChip = {
  label: string;
  hint?: string;
};

const VALIDATION_TIER_RANK: Record<ValidationTier, number> = {
  SELF_ATTESTED: 1,
  CERTIFICATE_ON_FILE: 2,
  TRUST_HALAL_VERIFIED: 3,
};

const MENU_POSTURE_LABELS: Record<MenuPosture, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Separate kitchens",
  HALAL_OPTIONS_ADVERTISED: "Halal options",
  HALAL_UPON_REQUEST: "Halal on request",
  MIXED_SHARED_KITCHEN: "Shared kitchen",
};

const ALCOHOL_POLICY_LABELS: Record<AlcoholPolicy, string> = {
  NONE: "No alcohol",
  BEER_AND_WINE_ONLY: "Beer & wine",
  FULL_BAR: "Full bar",
};

/**
 * Build the single primary trust pill for a place. Returns null when
 * we can't render a profile signal at all (place exists but no embed
 * was sent down — not the same as "no halal info yet"; the missing
 * profile case has its own pill via ``noHalalProfileSignal``).
 */
export function primaryHalalSignal(
  profile: HalalProfileEmbed | null,
): PrimaryHalalSignal {
  if (profile === null) {
    return noHalalProfileSignal();
  }

  // Disputes outrank everything else — a verified profile that's
  // currently disputed should NOT read "verified halal" without
  // qualification. Owner-reconciling is a softer state (the owner
  // has acknowledged + is updating), but still warrants the warning
  // tone so the consumer knows things are in flux.
  if (
    profile.dispute_state === "DISPUTED" ||
    profile.dispute_state === "RECONCILING"
  ) {
    const reconciling = profile.dispute_state === "RECONCILING";
    return {
      label: reconciling ? "⚠ Reconciling" : "⚠ Disputed",
      tone: "warning",
      description: reconciling
        ? "The owner is updating their halal info after a consumer report. Check back soon."
        : "A consumer reported this profile may be inaccurate. Trust Halal is reviewing.",
    };
  }

  const fullyHalal = profile.menu_posture === "FULLY_HALAL";

  switch (profile.validation_tier) {
    case "TRUST_HALAL_VERIFIED":
      return {
        label: fullyHalal ? "✓ Verified halal" : "✓ Verified halal options",
        tone: "positive",
        description: fullyHalal
          ? "A Trust Halal verifier visited and confirmed this place serves only halal food."
          : "A Trust Halal verifier visited and confirmed the halal options on the menu.",
      };
    case "CERTIFICATE_ON_FILE":
      return {
        label: fullyHalal ? "Halal certified" : "Halal options · certified",
        tone: "trusted",
        description: fullyHalal
          ? "The owner has a current halal certificate on file."
          : "The owner has a current halal certificate on file. Some menu items may not be halal.",
      };
    case "SELF_ATTESTED":
      return {
        label: fullyHalal ? "Owner-attested halal" : "Halal options",
        tone: "neutral",
        description: fullyHalal
          ? "The owner says the kitchen is fully halal. No third-party verification on file."
          : "The owner says halal options are available. No third-party verification on file.",
      };
  }

  // Forward-compat fallback when the API ships a new tier we don't
  // recognize yet — render a neutral "Halal information available"
  // pill rather than nothing, and let the user dig into the detail
  // page for the real story.
  return {
    label: "Halal info available",
    tone: "neutral",
    description: "Halal information is on file. Open the place page for details.",
  };
}

/**
 * Pill returned when a place has no approved halal profile. Visual
 * distinction matters: this is "we don't know" rather than "we know
 * it's not halal" — the consumer might still want to go (it could
 * just be unclaimed) and the detail page surfaces a dispute /
 * verifier visit CTA.
 */
export function noHalalProfileSignal(): PrimaryHalalSignal {
  return {
    label: "No halal info yet",
    tone: "muted",
    description:
      "Trust Halal hasn't verified this place yet. The owner can claim and submit halal info, or you can request a verifier visit.",
  };
}

/**
 * Compact chips of true-only halal facts. Order matters — the most
 * informationally dense / commonly-filtered-on chips come first so
 * a max-4-visible truncation still tells the most useful story.
 *
 * Why no negative chips: a "Pork served" or "Alcohol served" chip
 * adds visual noise to the 95% case where the place is pork-free /
 * alcohol-free, and a missing chip is easier to scan than an
 * always-present negative one. The detail page surfaces the full
 * negative + positive picture for a user who really wants to drill
 * in.
 */
export function halalFactsFor(profile: HalalProfileEmbed): HalalFactChip[] {
  const out: HalalFactChip[] = [];

  // Slaughter method — show one Zabihah chip when ANY meat is hand-
  // slaughtered. Per-meat granularity belongs on the detail page; on
  // a result card "Zabihah" is the reassurance signal users scan
  // for. ``hint`` enumerates which meats specifically.
  const zabihahMeats = (
    [
      ["chicken", profile.chicken_slaughter],
      ["beef", profile.beef_slaughter],
      ["lamb", profile.lamb_slaughter],
      ["goat", profile.goat_slaughter],
    ] as const
  )
    .filter(([, method]) => method === "ZABIHAH")
    .map(([meat]) => meat);

  if (zabihahMeats.length > 0) {
    out.push({
      label: "Zabihah",
      hint: `Hand-slaughtered: ${zabihahMeats.join(", ")}`,
    });
  }

  if (profile.has_certification) {
    out.push({
      label: profile.certifying_body_name
        ? `Cert · ${profile.certifying_body_name}`
        : "Certified",
      hint: profile.certifying_body_name
        ? `Halal certificate on file from ${profile.certifying_body_name}.`
        : "Halal certificate on file.",
    });
  }

  if (!profile.has_pork) {
    out.push({ label: "Pork-free", hint: "No pork on the menu." });
  }

  if (profile.alcohol_policy === "NONE") {
    out.push({
      label: "No alcohol",
      hint: "No alcohol served on premises.",
    });
  } else if (profile.alcohol_policy === "BEER_AND_WINE_ONLY") {
    out.push({
      label: ALCOHOL_POLICY_LABELS["BEER_AND_WINE_ONLY"],
      hint: "Beer and wine served. No spirits.",
    });
  }

  if (profile.seafood_only) {
    out.push({
      label: "Seafood only",
      hint: "No land meat served — only fish / seafood.",
    });
  }

  if (profile.menu_posture === "FULLY_HALAL") {
    out.push({
      label: "Fully halal",
      hint: "Every item on the menu is halal.",
    });
  } else if (profile.menu_posture === "MIXED_SEPARATE_KITCHENS") {
    out.push({
      label: "Separate kitchen",
      hint: "Halal items prepared in a physically separate kitchen.",
    });
  }

  if (profile.alcohol_in_cooking) {
    // Alcohol-in-cooking IS a negative chip — but the strict
    // observers who care about it overwhelmingly want to know,
    // so it earns the visual cost. Tone-coded warning on the
    // renderer side.
    out.push({
      label: "Alcohol in cooking",
      hint: "Some menu items use alcohol (wine reductions, mirin, etc.) in preparation.",
    });
  }

  return out;
}

/**
 * Convenience wrapper: take a search-result row and return both the
 * primary pill and the facts. Used by the result card so it doesn't
 * have to call two helpers.
 */
export function halalDisplayFor(place: PlaceSearchResult): {
  primary: PrimaryHalalSignal;
  facts: HalalFactChip[];
} {
  const primary = primaryHalalSignal(place.halal_profile);
  const facts = place.halal_profile ? halalFactsFor(place.halal_profile) : [];
  return { primary, facts };
}

/**
 * Tone → Tailwind class string mapping. Lives here because the tone
 * concept is part of the display contract, but the actual classes
 * are UI choices the result card and the place-detail page both
 * consume. Keeping them in lock-step from one place avoids drift
 * when (e.g.) we tweak the amber for ``trusted``.
 *
 * Returned classes are scoped to the pill itself — caller is
 * responsible for sizing / typography.
 */
export const PRIMARY_TONE_CLASSES: Record<HalalSignalTone, string> = {
  // Positive == brand olive / sage. Same family as primary buttons
  // so the trust signal speaks the brand's primary trust voice.
  positive:
    "border-primary/30 bg-primary text-primary-foreground",
  // Trusted == warm amber. Distinct from positive but still
  // actively confidence-inspiring.
  trusted:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  // Neutral == slate. Honest, not loud — the owner says it's halal
  // and we're rendering that as-is.
  neutral:
    "border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
  // Muted == "we don't know yet". Dashed border to signal incomplete.
  muted:
    "border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground",
  // Warning == disputed / reconciling. Red-amber to flag without
  // being a hard "do not eat" red — the place is questioned, not
  // condemned.
  warning:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
};
