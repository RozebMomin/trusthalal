"use client";

/**
 * `/get-verified`, Stage 3: confirm halal details.
 *
 * A deliberately short questionnaire per the wizard mockup, menu
 * posture + alcohol policy + an optional certificate, layered on the
 * existing halal-claim wiring:
 *
 *   * `useMyOwnedPlaces` supplies the (place, sponsoring org) pair.
 *     Gated gracefully when the owner has no approved place yet.
 *   * `useCreateMyHalalClaim` mints the DRAFT with a `structured_response`
 *     built from the two toggles plus sensible defaults for the rest.
 *   * Optional certificate uploads via `useUploadMyHalalClaimAttachment`
 *     (document_type HALAL_CERTIFICATE).
 *   * `useSubmitMyHalalClaim` flips DRAFT → PENDING_REVIEW.
 *
 * The advanced per-meat sourcing is intentionally left out of the
 * wizard; if the server's strict submit validation wants more, we
 * hand the owner off to the full editor at `/my-halal-claims/[id]`
 * (the existing flow, untouched) to finish.
 */

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type AlcoholPolicy,
  type HalalQuestionnaireDraft,
  type MeatProductSourcing,
  type MeatType,
  type MenuPosture,
  type OwnedPlaceRead,
  type SlaughterMethod,
  useCreateMyHalalClaim,
  useMyOwnedPlaces,
  usePatchMyHalalClaim,
  useSubmitMyHalalClaim,
  useUploadMyHalalClaimAttachment,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

import { FileDrop, stageFiles } from "../_components/file-drop";
import { type RailStage, WizardShell } from "../_components/wizard";

const RAIL: RailStage[] = [
  { title: "Register your business", sub: "Verified", state: "done" },
  { title: "Claim your restaurant", sub: "Approved", state: "done" },
  { title: "Confirm halal details", sub: "In progress", state: "now" },
];

const MENU_OPTIONS: Array<{ value: MenuPosture; label: string; help: string }> = [
  {
    value: "FULLY_HALAL",
    label: "Fully halal",
    help: "The entire menu is halal.",
  },
  {
    value: "HALAL_OPTIONS_ADVERTISED",
    label: "Halal options",
    help: "Halal items are marked alongside others.",
  },
  {
    value: "HALAL_UPON_REQUEST",
    label: "On request",
    help: "The default menu isn't halal, but the kitchen prepares halal when asked.",
  },
];

const ALCOHOL_OPTIONS: Array<{ value: AlcoholPolicy; label: string }> = [
  { value: "NONE", label: "None" },
  { value: "BEER_AND_WINE_ONLY", label: "Beer & wine" },
  { value: "FULL_BAR", label: "Full bar" },
];

export default function HalalStagePage() {
  const ownedPlaces = useMyOwnedPlaces();

  if (ownedPlaces.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const rows = ownedPlaces.data ?? [];
  if (rows.length === 0) {
    return <NeedsPlaceGate />;
  }

  return <HalalForm rows={rows} />;
}

function NeedsPlaceGate() {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold tracking-tight">No approved restaurant yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Halal details attach to a restaurant you own. Once your restaurant
        claim is approved, this step unlocks automatically.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/get-verified">
          <Button>Back to roadmap</Button>
        </Link>
      </div>
    </div>
  );
}

function HalalForm({ rows }: { rows: OwnedPlaceRead[] }) {
  const router = useRouter();
  const create = useCreateMyHalalClaim();
  const patch = usePatchMyHalalClaim();
  const upload = useUploadMyHalalClaimAttachment();
  const submit = useSubmitMyHalalClaim();

  // Default to the first place still missing a halal profile.
  const initialPlace =
    rows.find((r) => !r.has_halal_profile)?.place_id ?? rows[0].place_id;
  const [placeId, setPlaceId] = React.useState(initialPlace);
  const selectedRow = rows.find((r) => r.place_id === placeId) ?? rows[0];

  const [menu, setMenu] = React.useState<MenuPosture>("FULLY_HALAL");
  const [alcohol, setAlcohol] = React.useState<AlcoholPolicy>("NONE");
  const [products, setProducts] = React.useState<MeatProductSourcing[]>([]);
  const [sourcingOpen, setSourcingOpen] = React.useState(false);
  const [certFiles, setCertFiles] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<React.ReactNode | null>(null);
  const [progress, setProgress] = React.useState<string | null>(null);

  // Once created, remember the claim id + whether the cert already
  // uploaded so a retry after a validation bounce doesn't duplicate.
  const claimIdRef = React.useRef<string | null>(null);
  const certUploadedRef = React.useRef(false);

  const busy =
    create.isPending || patch.isPending || upload.isPending || submit.isPending;

  function addFiles(incoming: FileList | File[]) {
    const { files, error } = stageFiles({
      incoming,
      current: certFiles,
      maxFiles: 1,
    });
    setCertFiles(files);
    setFileError(error);
  }
  function removeFile() {
    setCertFiles([]);
    setFileError(null);
    certUploadedRef.current = false;
  }

  function buildQuestionnaire(): HalalQuestionnaireDraft {
    return {
      questionnaire_version: 1,
      menu_posture: menu,
      has_pork: false,
      alcohol_policy: alcohol,
      alcohol_in_cooking: false,
      seafood_only: false,
      // Only rows the owner actually named a supplier or picked a method for
      // are meaningful; a bare row is dropped rather than posted as noise.
      meat_products: products.filter(
        (p) => (p.supplier_name && p.supplier_name.trim()) || p.slaughter_method,
      ),
      has_certification: certFiles.length > 0,
      certifying_body_name: null,
      caveats: null,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErrorMsg(null);
    setProgress(null);

    const questionnaire = buildQuestionnaire();

    // Step 1, create (first attempt) or patch (retry) the draft.
    let claimId = claimIdRef.current;
    try {
      if (!claimId) {
        const created = await create.mutateAsync({
          place_id: selectedRow.place_id,
          organization_id: selectedRow.organization_id,
          structured_response: questionnaire,
        });
        claimId = created.id;
        claimIdRef.current = created.id;
      } else {
        await patch.mutateAsync({
          claimId,
          patch: { structured_response: questionnaire },
        });
      }
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't save your halal details",
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
      return;
    }

    // Step 2, optional certificate upload (once).
    if (certFiles.length > 0 && !certUploadedRef.current) {
      setProgress("Uploading certificate…");
      try {
        await upload.mutateAsync({
          claimId,
          file: certFiles[0],
          document_type: "HALAL_CERTIFICATE",
        });
        certUploadedRef.current = true;
      } catch (err) {
        const { description } = friendlyApiError(err, {
          defaultTitle: "Couldn't upload your certificate",
        });
        setErrorMsg(description);
        setProgress(null);
        return;
      }
      setProgress(null);
    }

    // Step 3, submit for review.
    try {
      await submit.mutateAsync(claimId);
    } catch (err) {
      // The strict submit validation can ask for more than this short
      // form captures, hand off to the full editor to finish rather
      // than block the owner here.
      if (
        err instanceof ApiError &&
        err.code === "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE"
      ) {
        setErrorMsg(
          <span>
            A few more details are needed before this can be submitted.{" "}
            <Link
              href={`/my-halal-claims/${claimId}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              Finish in the full editor →
            </Link>
          </span>,
        );
        return;
      }
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't submit your halal details",
      });
      setErrorMsg(description);
      return;
    }

    router.push("/get-verified");
  }

  return (
    <form onSubmit={onSubmit}>
      <WizardShell
        stages={RAIL}
        title="Tell diners about your halal."
        lead={
          <>
            For <strong>{selectedRow.place_name}</strong>. Just the essentials,
            you can refine anytime later.
          </>
        }
        footer={
          <>
            <span className="text-xs text-muted-foreground">Step 3 of 3</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/get-verified")}
                disabled={busy}
              >
                Back
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit halal details"}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          {rows.length > 1 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Restaurant
              </p>
              <select
                value={placeId}
                onChange={(e) => {
                  setPlaceId(e.target.value);
                  // A different place is a different claim, reset the
                  // create/upload guards.
                  claimIdRef.current = null;
                  certUploadedRef.current = false;
                }}
                disabled={busy}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rows.map((r) => (
                  <option key={r.place_id} value={r.place_id}>
                    {r.place_name}
                    {r.has_halal_profile ? " (has halal profile)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Your menu is…
              </p>
              {MENU_OPTIONS.map((opt) => (
                <OptionCard
                  key={opt.value}
                  label={opt.label}
                  help={opt.help}
                  selected={menu === opt.value}
                  onClick={() => setMenu(opt.value)}
                  disabled={busy}
                />
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Alcohol on premises
              </p>
              {ALCOHOL_OPTIONS.map((opt) => (
                <OptionCard
                  key={opt.value}
                  label={opt.label}
                  selected={alcohol === opt.value}
                  onClick={() => setAlcohol(opt.value)}
                  disabled={busy}
                />
              ))}
            </div>
          </div>

          {/* Primary: where the meat comes from. This is the trust signal
              diners care about most, so it leads — and it stays IN the wizard
              (expands inline, no redirect). */}
          <div className="rounded-lg border-2 border-primary/30 bg-primary/5">
            <button
              type="button"
              onClick={() => setSourcingOpen((o) => !o)}
              disabled={busy}
              className="flex w-full items-start justify-between gap-3 p-4 text-left disabled:opacity-50"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Where does your meat come from?
                </p>
                <p className="text-xs text-muted-foreground">
                  Add per-meat sourcing — chicken, beef, lamb, goat — with your
                  supplier and whether it&apos;s zabihah or hand-cut. This is
                  what diners trust most.
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium text-primary">
                {sourcingOpen
                  ? "Hide"
                  : products.length > 0
                    ? `${products.length} added`
                    : "Add sourcing"}
              </span>
            </button>
            {sourcingOpen && (
              <div className="border-t border-primary/20 p-4">
                <MeatSourcingEditor
                  products={products}
                  onChange={setProducts}
                  disabled={busy}
                />
              </div>
            )}
          </div>

          {/* Secondary + small: restaurant-level certification only. Clarified
              so owners don't confuse it with per-item/supplier certificates. */}
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Restaurant certification (optional)
            </p>
            <p className="text-xs text-muted-foreground">
              Only if your restaurant <em>itself</em> holds a halal certificate —
              e.g. the whole kitchen is certified by a body. Most halal
              restaurants don&apos;t; your meat sourcing above is what matters
              most.
            </p>
            <FileDrop
              files={certFiles}
              onAdd={addFiles}
              onRemove={removeFile}
              disabled={busy}
              error={fileError}
              maxFiles={1}
              multiple={false}
              prompt="Drop your restaurant's certificate here, or "
              hint="PDF or photo · optional"
            />
          </div>

          {progress && (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {progress}
            </p>
          )}
          {errorMsg && (
            <p role="alert" aria-live="polite" className="text-sm text-destructive">
              {errorMsg}
            </p>
          )}
        </div>
      </WizardShell>
    </form>
  );
}

function OptionCard({
  label,
  help,
  selected,
  onClick,
  disabled,
}: {
  label: string;
  help?: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
        selected && "border-2 border-primary",
      )}
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {help && (
          <span className="block text-xs text-muted-foreground">{help}</span>
        )}
      </span>
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {selected && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline per-meat sourcing — the wizard "essentials" version. Species-aware:
// poultry uses hand/machine; red meat asks zabihah (mapped to the wire's
// slaughter_method — the server rolls HAND_CUT → ZABIHAH, NOT_DISCLOSED →
// UNSURE for beef/lamb/goat). Kept lightweight; the full editor at
// /my-halal-claims/[id] still covers product names, cities, cert numbers, etc.
// ---------------------------------------------------------------------------
const WIZARD_MEATS: Array<{ value: MeatType; label: string }> = [
  { value: "CHICKEN", label: "Chicken" },
  { value: "BEEF", label: "Beef" },
  { value: "LAMB", label: "Lamb" },
  { value: "GOAT", label: "Goat" },
  { value: "TURKEY", label: "Turkey" },
  { value: "DUCK", label: "Duck" },
];
const POULTRY = new Set<MeatType>(["CHICKEN", "TURKEY", "DUCK"]);

function methodOptions(
  meat: MeatType,
): Array<{ value: SlaughterMethod; label: string }> {
  return POULTRY.has(meat)
    ? [
        { value: "HAND_CUT", label: "Hand-cut" },
        { value: "MACHINE_CUT", label: "Machine-cut" },
      ]
    : [
        { value: "HAND_CUT", label: "Zabihah" },
        { value: "NOT_DISCLOSED", label: "Not sure" },
      ];
}
const meatLabel = (m: MeatType) =>
  WIZARD_MEATS.find((x) => x.value === m)?.label ?? m;

function blankSourcing(): MeatProductSourcing {
  return {
    meat_type: "CHICKEN",
    product_name: "Chicken",
    slaughter_method: "HAND_CUT",
    supplier_name: null,
    supplier_city: null,
    supplier_state: null,
    certifying_authority: null,
    certificate_number: null,
  };
}

function MeatSourcingEditor({
  products,
  onChange,
  disabled,
}: {
  products: MeatProductSourcing[];
  onChange: (next: MeatProductSourcing[]) => void;
  disabled?: boolean;
}) {
  const inputCls =
    "flex h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

  function patch(i: number, p: Partial<MeatProductSourcing>) {
    onChange(products.map((row, idx) => (idx === i ? { ...row, ...p } : row)));
  }
  function setMeat(i: number, meat: MeatType) {
    const opts = methodOptions(meat);
    const cur = products[i].slaughter_method;
    const method = opts.some((o) => o.value === cur) ? cur : opts[0].value;
    patch(i, {
      meat_type: meat,
      product_name: meatLabel(meat),
      slaughter_method: method,
    });
  }

  return (
    <div className="space-y-3">
      {products.map((p, i) => (
        <div key={i} className="space-y-2 rounded-md border bg-background p-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              className={inputCls}
              value={p.meat_type}
              disabled={disabled}
              onChange={(e) => setMeat(i, e.target.value as MeatType)}
              aria-label="Meat"
            >
              {WIZARD_MEATS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              className={inputCls}
              value={p.slaughter_method}
              disabled={disabled}
              onChange={(e) =>
                patch(i, { slaughter_method: e.target.value as SlaughterMethod })
              }
              aria-label="Method"
            >
              {methodOptions(p.meat_type).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <input
            className={inputCls}
            type="text"
            disabled={disabled}
            placeholder="Supplier name (optional)"
            value={p.supplier_name ?? ""}
            onChange={(e) => patch(i, { supplier_name: e.target.value || null })}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(products.filter((_, idx) => idx !== i))}
            className="text-xs text-muted-foreground transition hover:text-destructive"
          >
            Remove
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...products, blankSourcing()])}
      >
        + Add a meat
      </Button>
    </div>
  );
}
