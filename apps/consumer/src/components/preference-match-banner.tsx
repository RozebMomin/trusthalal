/**
 * "Does this place match your preferences?" banner.
 *
 * Renders ABOVE the halal profile detail when the consumer has at
 * least one preference saved. Two states:
 *
 *   * Match — short emerald confirmation chip listing what matched.
 *   * Mismatch — amber callout explaining which preferences this
 *     place fails on and why. Doesn't hide the rest of the page —
 *     the consumer can still read the profile and decide for
 *     themselves.
 *
 * Suppressed entirely when ``hasAnyPreference`` is false (default
 * state for users who never saved anything) so the page doesn't
 * acquire dead UI for the casual visitor.
 */
import { CheckCircle2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import type { MatchResult } from "@/lib/preferences/match";

export function PreferenceMatchBanner({ result }: { result: MatchResult }) {
  if (!result.hasAnyPreference) return null;

  if (result.isMatch) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          <strong>Matches your preferences.</strong>{" "}
          {summarize(result.matched.map((m) => m.label))}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          <strong>Doesn&rsquo;t match your preferences.</strong>{" "}
          Trust Halal still shows you the listing so you can decide
          for yourself.
        </p>
      </div>
      <ul className="ml-6 list-disc space-y-0.5 text-xs">
        {result.mismatched.map((entry) => (
          <li key={entry.key}>
            <strong>{entry.label}:</strong> {entry.reason}
          </li>
        ))}
      </ul>
      <p className="ml-6 text-xs">
        <Link
          href="/preferences"
          className="underline hover:no-underline"
        >
          Adjust your preferences
        </Link>{" "}
        if you want to loosen these filters.
      </p>
    </div>
  );
}

function summarize(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
