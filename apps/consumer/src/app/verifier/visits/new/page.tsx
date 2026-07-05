"use client";

/**
 * Submit a new verification visit.
 *
 * Minimum viable form: pick a place (via search-as-you-type against
 * the public /places endpoint), set the visit date, declare
 * disclosure, and add notes. Optional public review URL for
 * verifiers who cover a visit on their own channel.
 *
 * Structured halal-questionnaire findings (the same shape owners
 * submit) are intentionally omitted from this first version. Admin
 * still gets a useful visit from the fields captured here; the
 * questionnaire form is complex enough to earn its own follow-up
 * slice.
 *
 * Attachments (photos of the certificate, the menu) are also
 * follow-up — the backend accepts them at
 * ``POST /me/verification-visits/{id}/attachments`` after the visit
 * is created.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type PlaceSearchResult,
  type VerificationVisitCreate,
  type VisitDisclosure,
  useSearchPlaces,
  useSubmitVerificationVisit,
} from "@/lib/api/hooks";

const DISCLOSURE_OPTIONS: { value: VisitDisclosure; label: string; help: string }[] = [
  {
    value: "SELF_FUNDED",
    label: "Self-funded",
    help: "I paid for my meal out of pocket. Default.",
  },
  {
    value: "MEAL_COMPED",
    label: "Meal comped",
    help: "The restaurant covered the meal.",
  },
  {
    value: "PAID_PARTNERSHIP",
    label: "Paid partnership",
    help: "I'm in a paid sponsorship with the restaurant.",
  },
  {
    value: "OTHER_DISCLOSURE",
    label: "Other",
    help: "Any other relationship worth flagging — explain below.",
  },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function NewVisitPage() {
  const router = useRouter();
  const submit = useSubmitVerificationVisit();

  const [selectedPlace, setSelectedPlace] =
    React.useState<PlaceSearchResult | null>(null);
  const [rawQuery, setRawQuery] = React.useState("");
  const debouncedQuery = useDebounced(rawQuery.trim(), 300);

  // ``useSearchPlaces`` gates its own enabled state on a non-empty
  // query — so passing an empty string when a place is already
  // selected keeps the request from firing. We also require ≥2
  // chars to avoid a burst of one-letter queries as the user types.
  const effectiveQuery =
    selectedPlace || debouncedQuery.length < 2 ? "" : debouncedQuery;
  const { data: searchResults, isFetching: searchFetching } = useSearchPlaces({
    q: effectiveQuery,
    limit: 8,
  });

  // Default visit date to "today" in the user's local zone.
  const today = React.useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const [visitedAt, setVisitedAt] = React.useState<string>(today);
  const [notes, setNotes] = React.useState("");
  const [publicReviewUrl, setPublicReviewUrl] = React.useState("");
  const [disclosure, setDisclosure] =
    React.useState<VisitDisclosure>("SELF_FUNDED");
  const [disclosureNote, setDisclosureNote] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const needsDisclosureNote =
    disclosure === "PAID_PARTNERSHIP" || disclosure === "OTHER_DISCLOSURE";
  const disclosureNoteMissing =
    needsDisclosureNote && !disclosureNote.trim();

  const formIncomplete =
    !selectedPlace || !visitedAt || disclosureNoteMissing;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submit.isPending || !selectedPlace) return;
    setErrorMsg(null);

    // Server expects ISO-8601 datetime. We captured a date — pin it
    // to noon local time so the DB row lands on the actual date the
    // verifier picked (a bare midnight can drift a day off in some
    // timezones).
    const visitedAtIso = new Date(`${visitedAt}T12:00:00`).toISOString();

    const payload: VerificationVisitCreate = {
      place_id: selectedPlace.id,
      visited_at: visitedAtIso,
      notes_for_admin: notes.trim() || null,
      public_review_url: publicReviewUrl.trim() || null,
      disclosure,
      disclosure_note: disclosureNote.trim() || null,
    };

    try {
      await submit.mutateAsync(payload);
      router.push("/verifier");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't submit your visit",
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/verifier" className="hover:underline">
          Dashboard
        </Link>
        <span className="mx-2">·</span>
        <span>Submit a visit</span>
      </nav>

      <h1 className="mb-2 font-serif text-3xl font-semibold sm:text-4xl">
        Submit a visit
      </h1>
      <p className="mb-8 text-muted-foreground">
        Report on a halal restaurant you&apos;ve visited in person.
        Admin reviews every submission — usually within a few days.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Place picker */}
        <div className="space-y-2">
          <Label htmlFor="place-search">
            Which restaurant did you visit?
            <span className="text-destructive"> *</span>
          </Label>

          {selectedPlace ? (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{selectedPlace.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      selectedPlace.address,
                      selectedPlace.city,
                      selectedPlace.region,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedPlace(null);
                    setRawQuery("");
                  }}
                >
                  Change
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Input
                id="place-search"
                type="search"
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
                placeholder="Search by name (e.g. Baraka Grill)"
                autoComplete="off"
              />
              {effectiveQuery && searchFetching && (
                <p className="text-xs text-muted-foreground">Searching…</p>
              )}
              {effectiveQuery && searchResults && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No matches. If the restaurant isn&apos;t in the catalog
                  yet, ask an admin to add it first.
                </p>
              )}
              {effectiveQuery && searchResults && searchResults.length > 0 && (
                <ul className="max-h-64 overflow-y-auto rounded-md border border-border bg-card">
                  {searchResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlace(p);
                          setRawQuery("");
                        }}
                        className="flex w-full items-start justify-between gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-accent/40"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{p.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {[p.address, p.city, p.region]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Visited date */}
        <div className="space-y-2">
          <Label htmlFor="visited_at">
            When did you visit?
            <span className="text-destructive"> *</span>
          </Label>
          <Input
            id="visited_at"
            type="date"
            value={visitedAt}
            max={today}
            onChange={(e) => setVisitedAt(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Must be today or earlier. Future dates are rejected.
          </p>
        </div>

        {/* Disclosure */}
        <fieldset className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-4">
          <legend className="px-2 text-sm font-semibold text-foreground">
            Disclosure<span className="text-destructive"> *</span>
          </legend>
          <p className="text-xs text-muted-foreground">
            Every visit requires an honest declaration of any
            compensation. Not disqualifying — just required.
          </p>
          {DISCLOSURE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-background/50"
            >
              <input
                type="radio"
                name="disclosure"
                value={opt.value}
                checked={disclosure === opt.value}
                onChange={(e) => setDisclosure(e.target.value as VisitDisclosure)}
                className="mt-1 h-4 w-4 border-border text-primary"
              />
              <div>
                <p className="font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.help}</p>
              </div>
            </label>
          ))}
          {needsDisclosureNote && (
            <div className="space-y-2 pt-2">
              <Label htmlFor="disclosure_note">
                Explain briefly
                <span className="text-destructive"> *</span>
              </Label>
              <Textarea
                id="disclosure_note"
                value={disclosureNote}
                onChange={(e) => setDisclosureNote(e.target.value)}
                placeholder="A sentence or two about the arrangement."
                rows={3}
                maxLength={2000}
                required
              />
            </div>
          )}
        </fieldset>

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">
            Notes for the admin team{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did you see? Anything specific about the halal claims — supplier stickers on the packaging, cert on the wall, kitchen setup, etc."
            rows={5}
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground">
            Specific beats general. &ldquo;Saw the IFANCA cert dated 2026-01,
            chicken bag from Al-Safa in the walk-in&rdquo; is more useful than
            &ldquo;place seems legit.&rdquo;
          </p>
        </div>

        {/* Public review URL */}
        <div className="space-y-2">
          <Label htmlFor="public_review_url">
            Link to your public review{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="public_review_url"
            type="url"
            value={publicReviewUrl}
            onChange={(e) => setPublicReviewUrl(e.target.value)}
            placeholder="https://instagram.com/p/..."
            maxLength={2048}
          />
          <p className="text-xs text-muted-foreground">
            If you posted about this visit on Instagram, YouTube, your blog,
            etc., paste the link so we can cross-reference.
          </p>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errorMsg}
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Button asChild variant="outline" type="button">
            <Link href="/verifier">Cancel</Link>
          </Button>
          <Button type="submit" disabled={formIncomplete || submit.isPending}>
            {submit.isPending ? "Submitting…" : "Submit visit"}
          </Button>
        </div>
      </form>
    </main>
  );
}
