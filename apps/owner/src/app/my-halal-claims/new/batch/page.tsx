"use client";

/**
 * Owner portal — batch-create halal claims.
 *
 * Reached from /my-halal-claims/new when the owner picks 2+ places.
 * Selections come in via the query string (multiple ?p=…&o=…
 * pairs); we resolve the place + org names against /me/owned-places
 * for display, capture a single shared questionnaire, then POST
 * /me/halal-claims/batch to create N drafts at once.
 *
 * The questionnaire shape here mirrors the per-claim detail page —
 * a leaner subset because there's no submit step (you batch-create
 * drafts, then submit each individually). Owners who want to fine-
 * tune one location's answers can edit that draft after creation.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type AlcoholPolicy,
  type HalalQuestionnaireDraft,
  type MeatSourcing,
  type MenuPosture,
  type MyHalalClaimBatchSelection,
  type OwnedPlaceRead,
  type SlaughterMethod,
  useBatchCreateMyHalalClaims,
  useMyOwnedPlaces,
} from "@/lib/api/hooks";

const MENU_POSTURE_OPTIONS: Array<{
  value: MenuPosture;
  label: string;
  description: string;
}> = [
  {
    value: "FULLY_HALAL",
    label: "Fully halal",
    description: "Entire menu is halal. No non-halal proteins on premises.",
  },
  {
    value: "MIXED_SEPARATE_KITCHENS",
    label: "Mixed — separate kitchens",
    description:
      "Some non-halal exists, prepared in physically separate equipment.",
  },
  {
    value: "HALAL_OPTIONS_ADVERTISED",
    label: "Halal options advertised",
    description:
      "Halal items are clearly marked on the menu alongside non-halal items.",
  },
  {
    value: "HALAL_UPON_REQUEST",
    label: "Halal upon request",
    description:
      "Halal items aren't advertised; the customer must ask. Default is non-halal.",
  },
  {
    value: "MIXED_SHARED_KITCHEN",
    label: "Mixed — shared kitchen",
    description:
      "Halal proteins exist but cooked on shared equipment with non-halal.",
  },
];

const ALCOHOL_OPTIONS: Array<{ value: AlcoholPolicy; label: string }> = [
  { value: "NONE", label: "No alcohol on premises" },
  { value: "BEER_AND_WINE_ONLY", label: "Beer / wine only" },
  { value: "FULL_BAR", label: "Full bar / spirits" },
];

const SLAUGHTER_OPTIONS: Array<{
  value: SlaughterMethod;
  label: string;
}> = [
  { value: "ZABIHAH", label: "Zabihah (hand-slaughtered)" },
  { value: "MACHINE", label: "Machine-slaughtered, halal-certified" },
  { value: "NOT_SERVED", label: "Not served" },
];

const MEAT_KEYS = ["chicken", "beef", "lamb", "goat"] as const;
type MeatKey = (typeof MEAT_KEYS)[number];

const MEAT_LABELS: Record<MeatKey, string> = {
  chicken: "Chicken",
  beef: "Beef",
  lamb: "Lamb",
  goat: "Goat",
};

export default function BatchHalalClaimPage() {
  const router = useRouter();
  const params = useSearchParams();
  const ownedPlaces = useMyOwnedPlaces();
  const batchCreate = useBatchCreateMyHalalClaims();

  // Decode selections from the querystring. ?p and ?o are paired
  // by index — they were emitted in order from the picker.
  const selections: MyHalalClaimBatchSelection[] = React.useMemo(() => {
    const placeIds = params?.getAll("p") ?? [];
    const orgIds = params?.getAll("o") ?? [];
    const out: MyHalalClaimBatchSelection[] = [];
    for (let i = 0; i < Math.min(placeIds.length, orgIds.length); i++) {
      out.push({ place_id: placeIds[i], organization_id: orgIds[i] });
    }
    return out;
  }, [params]);

  // Resolve to OwnedPlaceRead rows for display (place name +
  // address). Filter out anything we don't recognize so a stale
  // querystring doesn't crash the page.
  const selectedRows: OwnedPlaceRead[] = React.useMemo(() => {
    if (!ownedPlaces.data) return [];
    const wanted = new Set(
      selections.map((s) => `${s.place_id}:${s.organization_id}`),
    );
    return ownedPlaces.data.filter((row) =>
      wanted.has(`${row.place_id}:${row.organization_id}`),
    );
  }, [ownedPlaces.data, selections]);

  const [draft, setDraft] = React.useState<HalalQuestionnaireDraft>({
    questionnaire_version: 1,
  });
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  function setField<K extends keyof HalalQuestionnaireDraft>(
    key: K,
    value: HalalQuestionnaireDraft[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setMeat(meat: MeatKey, sourcing: MeatSourcing | null) {
    setDraft((d) => ({ ...d, [meat]: sourcing }));
  }

  function removeSelection(row: OwnedPlaceRead) {
    const newParams = new URLSearchParams();
    for (const r of selectedRows) {
      if (
        r.place_id === row.place_id &&
        r.organization_id === row.organization_id
      ) {
        continue;
      }
      newParams.append("p", r.place_id);
      newParams.append("o", r.organization_id);
    }
    if (Array.from(newParams.getAll("p")).length === 0) {
      router.push("/my-halal-claims/new");
    } else {
      router.replace(`/my-halal-claims/new/batch?${newParams.toString()}`);
    }
  }

  async function onCreate() {
    if (selections.length === 0 || batchCreate.isPending) return;
    setErrorMsg(null);
    try {
      const created = await batchCreate.mutateAsync({
        selections,
        structured_response: draft,
      });
      // Land on the list page; toast/inline confirmation could be
      // added later. For now, the list shows the new drafts at the
      // top.
      router.push(
        `/my-halal-claims?created=${encodeURIComponent(String(created.length))}`,
      );
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't create the drafts",
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again."
          : description,
      );
    }
  }

  if (selections.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link
          href="/my-halal-claims/new"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Pick places
        </Link>
        <p className="text-sm text-muted-foreground">
          No places selected. Go back and choose at least one.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link
          href="/my-halal-claims/new"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Pick different places
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Halal claim — {selections.length} place
          {selections.length === 1 ? "" : "s"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Fill out the questionnaire once. We&apos;ll create a draft
          for each place below — you can edit any of them
          individually before submitting for review.
        </p>
      </header>

      <section className="space-y-2 rounded-md border bg-card p-4">
        <h2 className="text-sm font-semibold">Applying to</h2>
        {ownedPlaces.isLoading && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        {selectedRows.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {selectedRows.map((row) => (
              <li
                key={`${row.place_id}:${row.organization_id}`}
                className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs"
              >
                <span className="font-medium">{row.place_name}</span>
                <span className="text-muted-foreground">
                  · {row.organization_name}
                </span>
                <button
                  type="button"
                  onClick={() => removeSelection(row)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Remove"
                  aria-label={`Remove ${row.place_name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-5 rounded-md border bg-card p-5">
        <h2 className="text-lg font-semibold">Halal questionnaire</h2>
        <p className="text-sm text-muted-foreground">
          The same answers apply to every selected place. After we
          create the drafts, you can fine-tune any of them
          individually before submitting for review.
        </p>

        <Field label="Menu posture">
          <div className="space-y-2">
            {MENU_POSTURE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 hover:bg-accent/40"
              >
                <input
                  type="radio"
                  name="menu_posture"
                  value={opt.value}
                  checked={draft.menu_posture === opt.value}
                  onChange={() => setField("menu_posture", opt.value)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </Field>

        <BoolField
          label="Pork on the menu?"
          help="Includes pork products like bacon, ham, pepperoni."
          value={draft.has_pork ?? null}
          onChange={(v) => setField("has_pork", v)}
        />

        <Field
          label="Alcohol policy"
          help="How alcohol is handled on premises."
        >
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={draft.alcohol_policy ?? ""}
            onChange={(e) =>
              setField(
                "alcohol_policy",
                (e.target.value || null) as AlcoholPolicy | null,
              )
            }
          >
            <option value="">— select —</option>
            {ALCOHOL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <BoolField
          label="Alcohol used in cooking?"
          help="Wine reductions, mirin, beer batter, etc."
          value={draft.alcohol_in_cooking ?? null}
          onChange={(v) => setField("alcohol_in_cooking", v)}
        />

        <Field
          label="Per-meat slaughter & sourcing"
          help="For each meat your restaurants serve, indicate how it's slaughtered. Select 'Not served' if you don't serve it."
        >
          <div className="space-y-3">
            {MEAT_KEYS.map((meat) => (
              <MeatRow
                key={meat}
                meat={meat}
                value={(draft[meat] as MeatSourcing | null | undefined) ?? null}
                onChange={(s) => setMeat(meat, s)}
              />
            ))}
          </div>
        </Field>

        <BoolField
          label="Seafood-only kitchen?"
          help="No land-meat at all (chicken / beef / lamb / goat all not served)."
          value={draft.seafood_only ?? null}
          onChange={(v) => setField("seafood_only", v)}
        />

        {/* "Halal certification on file?" + "Certifying authority"
            used to live here. They were redundant with the
            HALAL_CERTIFICATE attachment + its issuing_authority
            field on the next step. The HalalProfile derivation now
            reads cert state straight from approved attachments,
            so the form keeps the question to one place. */}

        <Field label="Anything else? (optional)">
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={3}
            maxLength={2000}
            value={draft.caveats ?? ""}
            onChange={(e) => setField("caveats", e.target.value || null)}
            placeholder="Anything a halal-conscious diner should know."
          />
        </Field>
      </section>

      {errorMsg && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-destructive"
        >
          {errorMsg}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
        <p className="text-sm text-muted-foreground">
          We&apos;ll create {selections.length} draft
          {selections.length === 1 ? "" : "s"} with these answers.
          Submission for review happens per-draft afterwards.
        </p>
        <Button
          type="button"
          onClick={() => void onCreate()}
          disabled={batchCreate.isPending}
        >
          {batchCreate.isPending
            ? "Creating drafts…"
            : `Create ${selections.length} draft${selections.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {children}
    </div>
  );
}

function BoolField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <Field label={label} help={help}>
      <div className="flex gap-2">
        <BoolButton
          label="Yes"
          active={value === true}
          onClick={() => onChange(true)}
        />
        <BoolButton
          label="No"
          active={value === false}
          onClick={() => onChange(false)}
        />
      </div>
    </Field>
  );
}

function BoolButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-md border px-3 py-1.5 text-sm transition",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-background hover:bg-accent",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function MeatRow({
  meat,
  value,
  onChange,
}: {
  meat: MeatKey;
  value: MeatSourcing | null;
  onChange: (sourcing: MeatSourcing | null) => void;
}) {
  const slaughter = value?.slaughter_method ?? null;
  const isServed = slaughter && slaughter !== "NOT_SERVED";

  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[5rem] text-sm font-medium">
          {MEAT_LABELS[meat]}
        </span>
        <select
          className="flex h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={slaughter ?? ""}
          onChange={(e) => {
            const next = (e.target.value || null) as
              | SlaughterMethod
              | null;
            if (next === null) {
              onChange(null);
            } else {
              onChange({
                slaughter_method: next,
                supplier_name: value?.supplier_name ?? null,
                supplier_location: value?.supplier_location ?? null,
              });
            }
          }}
        >
          <option value="">— select —</option>
          {SLAUGHTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {isServed && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            type="text"
            placeholder="Supplier name"
            value={value?.supplier_name ?? ""}
            onChange={(e) =>
              onChange({
                slaughter_method: slaughter as SlaughterMethod,
                supplier_name: e.target.value || null,
                supplier_location: value?.supplier_location ?? null,
              })
            }
            maxLength={255}
          />
          <Input
            type="text"
            placeholder="Supplier location (city / state)"
            value={value?.supplier_location ?? ""}
            onChange={(e) =>
              onChange({
                slaughter_method: slaughter as SlaughterMethod,
                supplier_name: value?.supplier_name ?? null,
                supplier_location: e.target.value || null,
              })
            }
            maxLength={255}
          />
        </div>
      )}
    </div>
  );
}
