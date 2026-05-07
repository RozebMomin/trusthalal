/**
 * Curated list of halal certifying authorities used by the owner
 * questionnaire's per-product cards AND the supporting-document
 * upload flow. Keeping the list in one place means adding a new
 * cert body lights up the dropdown in both surfaces at once.
 *
 * Free text vs. enum:
 * The list is *suggestions*, not a closed set. The server stores
 * ``certifying_authority`` and ``issuing_authority`` as plain
 * strings — owners with a body that isn't on the list pick "Other"
 * and type the name. We keep server-side validation lax on
 * purpose: the global halal-cert space is too long-tail to enforce
 * an enum without locking out edge cases (small mosque-issued
 * certs, regional bodies in markets we don't yet cover). Clients
 * reach for the curated list to keep canonical names spelled
 * consistently; "Other" is the safety valve.
 *
 * When extending: keep the names short and unambiguous. If a body
 * has a well-known abbreviation (IFANCA, JAKIM), prefer the
 * abbreviation as the canonical token — the longer name lands in
 * ``description``. Owners scan the abbreviations.
 */

export type CertifyingAuthorityOption = {
  /** What gets stored on the row (and displayed). */
  value: string;
  /** Optional one-line gloss rendered next to the dropdown option. */
  description?: string;
};

export const CERTIFYING_AUTHORITIES: ReadonlyArray<CertifyingAuthorityOption> = [
  {
    value: "IFANCA",
    description: "Islamic Food and Nutrition Council of America",
  },
  {
    value: "HTO",
    description: "Halal Transactions of Omaha",
  },
  {
    value: "HMS",
    description: "Halal Monitoring Services",
  },
  {
    value: "HFSAA",
    description: "Halal Food Standards Alliance of America",
  },
  {
    value: "ISA",
    description: "Islamic Services of America",
  },
  {
    value: "AHF",
    description: "American Halal Foundation",
  },
  {
    value: "HMC",
    description: "Halal Monitoring Committee (UK / global)",
  },
  {
    value: "JAKIM",
    description: "Department of Islamic Development Malaysia",
  },
  {
    value: "MUI",
    description: "Indonesian Council of Ulama",
  },
];

/** Sentinel values for the dropdown UI. Never sent to the server. */
export const AUTH_NONE_SENTINEL = "__none__";
export const AUTH_OTHER_SENTINEL = "__other__";

/**
 * Map a stored string back to a dropdown selection.
 *
 *   - ``null`` / ``undefined``  → ``__none__`` (nothing selected)
 *   - ``""`` (empty string)     → ``__other__`` (user just clicked
 *                                  "Other" but hasn't typed yet —
 *                                  IMPORTANT: ``""`` must NOT
 *                                  collapse to ``__none__`` or the
 *                                  free-text input never gets a
 *                                  chance to render after the click)
 *   - matches a curated value   → the value verbatim
 *   - anything else             → ``__other__`` (free-text fallback)
 *
 * The corresponding free-text input only renders for the
 * ``__other__`` case, pre-populated with the stored string.
 */
export function authoritySentinelFor(stored: string | null | undefined): string {
  if (stored === null || stored === undefined) {
    return AUTH_NONE_SENTINEL;
  }
  if (stored === "") {
    return AUTH_OTHER_SENTINEL;
  }
  const match = CERTIFYING_AUTHORITIES.find((o) => o.value === stored);
  return match ? match.value : AUTH_OTHER_SENTINEL;
}
