import { Badge } from "@/components/ui/badge";
import type { SlaughterMethodValue, SupplierTier } from "@/lib/api/hooks";

const TIER: Record<SupplierTier, { label: string; cls: string }> = {
  LISTED: { label: "Listed", cls: "border-border text-muted-foreground" },
  CERTIFICATE_ON_FILE: {
    label: "Certificate on file",
    cls: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  },
  TRUST_HALAL_VERIFIED: {
    label: "Trust Halal verified",
    cls: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  },
};

/** Confidence tier — legitimately ranked, so colour tracks rigour. */
export function TierBadge({ tier }: { tier: SupplierTier }) {
  const { label, cls } = TIER[tier];
  return (
    <Badge variant="outline" className={cls}>
      {label}
    </Badge>
  );
}

const METHOD: Record<SlaughterMethodValue, string> = {
  HAND_CUT: "Hand-cut",
  MACHINE_CUT: "Machine-cut",
  NOT_DISCLOSED: "Not disclosed",
};

/**
 * Slaughter method. Deliberately NEUTRAL — hand-cut and machine-cut get the
 * same visual weight (no green-vs-amber ranking), per the brand neutrality
 * rule; only "not disclosed" is muted. We describe the fact, we don't judge it.
 */
export function MethodBadge({ method }: { method: SlaughterMethodValue }) {
  if (method === "NOT_DISCLOSED") {
    return (
      <Badge variant="outline" className="border-border text-muted-foreground">
        {METHOD[method]}
      </Badge>
    );
  }
  return <Badge variant="secondary">{METHOD[method]}</Badge>;
}
