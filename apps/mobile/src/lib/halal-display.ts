/**
 * The trust vocabulary — direct port of the tier logic from
 * apps/consumer/src/lib/halal-display.ts, re-skinned to the v2 tag
 * language (solid emerald / amber wash / zinc wash / dashed / red).
 * Wording is identical to the web; never improvise here.
 */
import type { Palette } from "@/lib/theme";
import type { HalalProfileEmbed } from "@/lib/api/types";

export type Tone = "positive" | "trusted" | "neutral" | "muted" | "warning";

export type PrimarySignal = { label: string; tone: Tone; description: string };

export function primaryHalalSignal(p: HalalProfileEmbed | null): PrimarySignal {
  if (p === null) {
    return {
      label: "NO HALAL INFO YET",
      tone: "muted",
      description:
        "Trust Halal hasn't verified this place yet. The owner can claim and submit halal info.",
    };
  }
  if (p.dispute_state === "DISPUTED" || p.dispute_state === "RECONCILING") {
    const rec = p.dispute_state === "RECONCILING";
    return {
      label: rec ? "RECONCILING" : "UNDER REVIEW",
      tone: "warning",
      description: rec
        ? "The owner is updating their halal info after a consumer report."
        : "A consumer reported this profile may be inaccurate. Trust Halal is reviewing.",
    };
  }
  const fully = p.menu_posture === "FULLY_HALAL";
  switch (p.validation_tier) {
    case "TRUST_HALAL_VERIFIED":
      return {
        label: fully ? "✓ VERIFIED HALAL" : "✓ VERIFIED OPTIONS",
        tone: "positive",
        description: "A Trust Halal verifier visited and confirmed in person.",
      };
    case "CERTIFICATE_ON_FILE":
      return {
        label: p.certifying_body_name
          ? `CERTIFIED · ${p.certifying_body_name.toUpperCase()}`
          : "HALAL CERTIFIED",
        tone: "trusted",
        description: "The owner has a current halal certificate on file.",
      };
    default:
      return {
        label: "OWNER-ATTESTED",
        tone: "neutral",
        description: "The owner says it's halal. No third-party verification yet.",
      };
  }
}

export function toneStyle(tone: Tone, t: Palette) {
  switch (tone) {
    case "positive":
      return { bg: t.accent, fg: "#FFFFFF", border: t.accent, dashed: false };
    case "trusted":
      return { bg: t.amberSoft, fg: t.amber, border: t.amberSoft, dashed: false };
    case "neutral":
      return { bg: t.zincSoft, fg: t.zinc, border: t.zincSoft, dashed: false };
    case "warning":
      return { bg: t.dangerSoft, fg: t.danger, border: t.dangerSoft, dashed: false };
    default:
      return { bg: "transparent", fg: t.sub, border: t.line, dashed: true };
  }
}
