/**
 * Consumer-facing halal-profile badges.
 *
 * Renders a compact set of trust labels for a place's
 * ``HalalProfileEmbed``. Used on the search results list (this
 * phase) and on the place detail page (Phase 9c).
 *
 * Design choices:
 *
 *   * Validation tier and menu posture are always rendered when a
 *     profile exists — they're the headline trust labels consumers
 *     scan for first.
 *   * The dispute-state badge only appears when state ≠ NONE so the
 *     common case (no disputes) doesn't show an "everything's fine"
 *     badge that adds visual noise.
 *   * No pork / no alcohol surface as small chips when the
 *     attribute is true — these are positive signals consumers
 *     filter for. The negative case (pork present, alcohol served)
 *     is conveyed by the ABSENCE of the chip rather than a "has
 *     pork" anti-badge that would be a different design problem.
 *
 * Mirrors the visual language of the admin panel's
 * HalalClaimStatusBadge but for consumer audiences — labels are
 * full sentences, no enum strings leak through.
 */
import * as React from "react";

import type {
  HalalProfileEmbed,
  MenuPosture,
  ValidationTier,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const VALIDATION_TIER_LABELS: Record<ValidationTier, string> = {
  SELF_ATTESTED: "Owner-attested",
  CERTIFICATE_ON_FILE: "Certificate on file",
  TRUST_HALAL_VERIFIED: "Trust Halal verified",
};

const VALIDATION_TIER_TONES: Record<ValidationTier, string> = {
  SELF_ATTESTED:
    "border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
  CERTIFICATE_ON_FILE:
    "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  TRUST_HALAL_VERIFIED:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
};

const MENU_POSTURE_LABELS: Record<MenuPosture, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Separate halal kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options on menu",
  HALAL_UPON_REQUEST: "Halal upon request",
  MIXED_SHARED_KITCHEN: "Halal on shared equipment",
};

function Chip({
  label,
  className,
  title,
}: {
  label: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * The "no halal profile yet" placeholder. Rendered in the same
 * visual slot as the badges so a place's row doesn't reflow when
 * it eventually gets a profile.
 */
export function HalalProfileMissingBadge() {
  return (
    <Chip
      label="No halal profile yet"
      className="border-dashed border-muted-foreground/30 bg-muted/30 text-muted-foreground"
      title="This place hasn't been verified by Trust Halal yet."
    />
  );
}

export function HalalProfileBadges({
  profile,
  className,
}: {
  profile: HalalProfileEmbed;
  className?: string;
}) {
  const validationLabel =
    VALIDATION_TIER_LABELS[profile.validation_tier] ??
    profile.validation_tier;
  const postureLabel =
    MENU_POSTURE_LABELS[profile.menu_posture] ?? profile.menu_posture;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Chip
        label={validationLabel}
        className={VALIDATION_TIER_TONES[profile.validation_tier]}
        title="How rigorously this profile was validated."
      />
      <Chip
        label={postureLabel}
        className="border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {!profile.has_pork && (
        <Chip
          label="No pork"
          className="border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      )}
      {profile.alcohol_policy === "NONE" && (
        <Chip
          label="No alcohol"
          className="border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      )}
      {profile.has_certification && profile.certifying_body_name && (
        <Chip
          label={`Cert: ${profile.certifying_body_name}`}
          className="border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      )}
      {profile.dispute_state === "DISPUTED" && (
        <Chip
          label="Disputed"
          className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          title="A consumer reported this profile may be inaccurate. Trust Halal is reviewing."
        />
      )}
      {profile.dispute_state === "RECONCILING" && (
        <Chip
          label="Owner reconciling"
          className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          title="The owner is updating their halal information in response to a consumer report."
        />
      )}
    </div>
  );
}
