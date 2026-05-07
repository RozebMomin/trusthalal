"use client";

/**
 * Dropdown for picking a halal certifying authority. Used in two
 * places that both ask the same question:
 *
 *   1. Per-product meat sourcing cards — ``certifying_authority``.
 *   2. Halal-claim attachment upload — ``issuing_authority``.
 *
 * Behaviour:
 *   - "None" (the default) → caller stores ``null``.
 *   - One of the curated authorities → caller stores that string.
 *   - "Other (specify)" → reveals a free-text input; caller stores
 *     whatever the owner types.
 *
 * The component is fully controlled — the parent owns the
 * ``string | null`` state and a single onChange. The "Other" UI
 * affordance is internal: we derive it from the value (if the
 * value is non-null and not in the curated list, we render the
 * input pre-populated).
 */

import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  AUTH_NONE_SENTINEL,
  AUTH_OTHER_SENTINEL,
  CERTIFYING_AUTHORITIES,
  authoritySentinelFor,
} from "@/lib/certifying-authorities";

type Props = {
  /** Optional id so a parent <Label htmlFor="…"> can hook in. */
  id?: string;
  /** What the parent currently holds. */
  value: string | null;
  /** Called whenever the effective value changes. */
  onChange: (next: string | null) => void;
  /** Optional aria-label for the select trigger. */
  ariaLabel?: string;
  /** Disables the select + the free-text input. */
  disabled?: boolean;
};

export function CertifyingAuthoritySelect({
  id,
  value,
  onChange,
  ariaLabel,
  disabled,
}: Props) {
  // The select tracks one of three "modes": none, a curated value,
  // or "other". We compute it from `value` on each render so the
  // component stays a pure function of the prop.
  const sentinel = authoritySentinelFor(value);
  const isOther = sentinel === AUTH_OTHER_SENTINEL;

  function onSelectChange(next: string) {
    if (next === AUTH_NONE_SENTINEL) {
      onChange(null);
    } else if (next === AUTH_OTHER_SENTINEL) {
      // Don't blow away any existing free text the owner typed —
      // if they're flipping FROM a curated value to "Other" we
      // start with empty string (the input will appear).
      onChange("");
    } else {
      onChange(next);
    }
  }

  return (
    <div className="space-y-2">
      <select
        id={id}
        aria-label={ariaLabel}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        value={sentinel}
        onChange={(e) => onSelectChange(e.target.value)}
        disabled={disabled}
      >
        <option value={AUTH_NONE_SENTINEL}>None / not certified</option>
        {CERTIFYING_AUTHORITIES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.description ? `${opt.value} — ${opt.description}` : opt.value}
          </option>
        ))}
        <option value={AUTH_OTHER_SENTINEL}>Other (specify)</option>
      </select>
      {isOther && (
        <Input
          type="text"
          aria-label="Custom certifying authority"
          placeholder="e.g. Local mosque XYZ"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          maxLength={255}
          disabled={disabled}
        />
      )}
    </div>
  );
}
