"use client";

/**
 * Owner portal — halal-claim detail with questionnaire + attachments
 * + submit-for-review.
 *
 * Three sections, top to bottom:
 *
 *   1. Questionnaire — radios / selects / text inputs covering menu
 *      posture, alcohol, per-meat, certification, caveats. Save with
 *      explicit "Save draft" button (no auto-save). Editable while
 *      DRAFT or NEEDS_MORE_INFO.
 *   2. Attachments — drag-drop + classify (HALAL_CERTIFICATE /
 *      SUPPLIER_LETTER / INVOICE / PHOTO / OTHER). Same pattern as
 *      the existing org/ownership-request upload UI.
 *   3. Submit — moves DRAFT → PENDING_REVIEW. Server re-validates
 *      the questionnaire strictly; field-level errors come back
 *      under error.detail and are surfaced inline.
 *
 * Once a claim leaves the editable statuses (i.e., admin has
 * decided), the form is read-only and the submit button is hidden.
 * Decision context (status badge + decision_note) renders at the
 * top so the owner sees admin's response immediately on landing.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  HalalClaimStatusBadge,
  halalClaimStatusDescription,
} from "@/components/halal-claim-status-badge";
import { CertifyingAuthoritySelect } from "@/components/certifying-authority-select";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type AlcoholPolicy,
  type HalalClaimAttachmentRead,
  type HalalClaimAttachmentType,
  type HalalQuestionnaireDraft,
  type MeatProductSourcing,
  type MeatType,
  type MenuPosture,
  type MyHalalClaimRead,
  type SlaughterMethod,
  HALAL_CLAIM_EDITABLE_STATUSES,
  useMyHalalClaim,
  useMyHalalClaimEvents,
  usePatchMyHalalClaim,
  useDeleteMyHalalClaim,
  useSubmitMyHalalClaim,
  useUploadMyHalalClaimAttachment,
} from "@/lib/api/hooks";
import { HalalClaimTimeline } from "@/components/halal-claim-timeline";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const ALLOWED_HUMAN = "PDF, JPEG, PNG, HEIC";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 8;

const DOCUMENT_TYPE_LABELS: Record<HalalClaimAttachmentType, string> = {
  HALAL_CERTIFICATE: "Halal certificate",
  SUPPLIER_LETTER: "Supplier letter",
  INVOICE: "Invoice",
  PHOTO: "Photo",
  OTHER: "Other",
};

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
      "Some non-halal exists, prepared in physically separate equipment to prevent cross-contamination.",
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
      "Halal items aren't advertised; the customer must explicitly ask. Default is non-halal.",
  },
  {
    value: "MIXED_SHARED_KITCHEN",
    label: "Mixed — shared kitchen",
    description:
      "Halal proteins exist but are cooked on shared equipment with non-halal items.",
  },
];

const ALCOHOL_OPTIONS: Array<{
  value: AlcoholPolicy;
  label: string;
}> = [
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

const MEAT_TYPE_OPTIONS: Array<{ value: MeatType; label: string }> = [
  { value: "CHICKEN", label: "Chicken" },
  { value: "BEEF", label: "Beef" },
  { value: "LAMB", label: "Lamb" },
  { value: "GOAT", label: "Goat" },
  { value: "TURKEY", label: "Turkey" },
  { value: "DUCK", label: "Duck" },
  { value: "FISH", label: "Fish" },
  { value: "OTHER", label: "Other" },
];

function blankProduct(): MeatProductSourcing {
  return {
    meat_type: "CHICKEN",
    product_name: "",
    slaughter_method: "ZABIHAH",
    supplier_name: null,
    supplier_city: null,
    supplier_state: null,
    certifying_authority: null,
    certificate_number: null,
  };
}

export default function MyHalalClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: claim, isLoading, isError, error } = useMyHalalClaim(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (isError) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Link
          href="/my-halal-claims"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All halal claims
        </Link>
        <p
          role="alert"
          className="rounded-md border bg-card px-4 py-3 text-sm text-destructive"
        >
          {status === 404
            ? "We couldn't find that halal claim."
            : status === 403
            ? "You don't have access to that halal claim."
            : "Couldn't load this halal claim. Try refreshing."}
        </p>
      </div>
    );
  }
  if (!claim) return null;
  return <ClaimDetailBody claim={claim} />;
}

function ClaimDetailBody({ claim }: { claim: MyHalalClaimRead }) {
  const isEditable = HALAL_CLAIM_EDITABLE_STATUSES.includes(claim.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <Link
          href="/my-halal-claims"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← All halal claims
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">
              {claim.place?.name ?? "Halal claim"}
            </h1>
            {claim.place && (
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {[
                  claim.place.address,
                  claim.place.city,
                  claim.place.country_code,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No address on file"}
              </p>
            )}
            {claim.organization && (
              <p className="mt-1 text-xs text-muted-foreground">
                Sponsored by{" "}
                <span className="font-medium text-foreground">
                  {claim.organization.name}
                </span>
              </p>
            )}
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              Claim {claim.id.slice(0, 8)}
            </p>
          </div>
          <HalalClaimStatusBadge status={claim.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {halalClaimStatusDescription(claim.status)}
        </p>
        {claim.decision_note && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <strong className="font-semibold">Trust Halal said: </strong>
            {claim.decision_note}
          </div>
        )}
      </header>

      <QuestionnaireSection claim={claim} editable={isEditable} />
      <AttachmentsSection claim={claim} editable={isEditable} />
      {isEditable && <SubmitSection claim={claim} />}
      <ActivitySection claimId={claim.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity timeline — the audit trail for this claim
// ---------------------------------------------------------------------------
function ActivitySection({ claimId }: { claimId: string }) {
  const { data, isLoading, error } = useMyHalalClaimEvents(claimId);
  return (
    <section className="space-y-4 rounded-md border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every step of this claim, oldest first. Trust Halal staff
          see the same timeline when reviewing.
        </p>
      </div>
      <HalalClaimTimeline
        events={data}
        isLoading={isLoading}
        error={error as Error | null}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Questionnaire form
// ---------------------------------------------------------------------------
function QuestionnaireSection({
  claim,
  editable,
}: {
  claim: MyHalalClaimRead;
  editable: boolean;
}) {
  const patch = usePatchMyHalalClaim();
  const [draft, setDraft] = React.useState<HalalQuestionnaireDraft>(
    () => claim.structured_response ?? {},
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<string[]>([]);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  // If the underlying claim changes (e.g. polled refresh), reset the
  // form to the server's view. This keeps the user in sync with
  // admin-driven status changes.
  React.useEffect(() => {
    setDraft(claim.structured_response ?? {});
  }, [claim.id, claim.structured_response]);

  function setField<K extends keyof HalalQuestionnaireDraft>(
    key: K,
    value: HalalQuestionnaireDraft[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // Per-product list helpers — questionnaire stores meat sourcing
  // as a flat list of products (Beef bacon, Ground beef, ...) so a
  // restaurant can declare different suppliers / certs per item.
  const products = draft.meat_products ?? [];
  function setProducts(next: MeatProductSourcing[]) {
    setDraft((d) => ({ ...d, meat_products: next }));
  }
  function patchProduct(index: number, patch: Partial<MeatProductSourcing>) {
    setProducts(
      products.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );
  }
  function addProduct() {
    setProducts([...products, blankProduct()]);
  }
  function removeProduct(index: number) {
    setProducts(products.filter((_, i) => i !== index));
  }

  async function onSave() {
    if (!editable || patch.isPending) return;
    setErrorMsg(null);
    setFieldErrors([]);
    try {
      await patch.mutateAsync({
        claimId: claim.id,
        patch: {
          structured_response: { ...draft, questionnaire_version: 1 },
        },
      });
      setSavedAt(Date.now());
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't save your answers",
      });
      setErrorMsg(description);
    }
  }

  return (
    <section className="space-y-5 rounded-md border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Halal questionnaire</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {editable
            ? "Save your answers as you go. Submit for review when everything is filled in."
            : "Read-only — the claim is past the editable stage."}
        </p>
      </div>

      <fieldset disabled={!editable} className="space-y-6">
        {/* Menu posture */}
        <Field
          label="Menu posture"
          help="How does your restaurant handle halal vs non-halal items?"
        >
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

        {/* Pork */}
        <BoolField
          label="Pork on the menu?"
          help="Includes pork products like bacon, ham, pepperoni."
          value={draft.has_pork ?? null}
          onChange={(v) => setField("has_pork", v)}
        />

        {/* Alcohol policy */}
        <Field
          label="Alcohol policy"
          help="How alcohol is handled on premises."
        >
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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

        {/* Meat products */}
        <Field
          label="Meat products"
          help="One entry per product you serve — e.g. 'Beef bacon' and 'Ground beef' as separate rows when they come from different suppliers. Each entry carries its own slaughter method and supplier / cert info. Skip if seafood-only."
        >
          <div className="space-y-3">
            {products.map((p, i) => (
              <ProductRow
                key={i}
                value={p}
                onChange={(patch) => patchProduct(i, patch)}
                onRemove={() => removeProduct(i)}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addProduct}
              disabled={!editable}
            >
              + Add product
            </Button>
          </div>
        </Field>

        <BoolField
          label="Seafood-only kitchen?"
          help="Check if you serve no land-meat at all (chicken / beef / lamb / goat are all not-served)."
          value={draft.seafood_only ?? null}
          onChange={(v) => setField("seafood_only", v)}
        />

        {/* Certification fields used to live here as a yes/no +
            certifying-body input. Removed because the same signal
            comes from the HALAL_CERTIFICATE attachment in the
            section below: the profile derivation now reads
            ``has_certification`` and ``certifying_body_name``
            straight off the attachments at approval time. Asking
            twice cluttered the form without improving the truth
            set. */}

        {/* Caveats */}
        <Field
          label="Anything else? (optional)"
          help="Surfaces to consumers as 'caveats' on your listing. Examples: 'Halal only at lunch', 'No halal options on Tuesdays.'"
        >
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            rows={3}
            maxLength={2000}
            value={draft.caveats ?? ""}
            onChange={(e) => setField("caveats", e.target.value || null)}
            placeholder="Anything a halal-conscious diner should know."
          />
        </Field>
      </fieldset>

      {errorMsg && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-destructive"
        >
          {errorMsg}
        </p>
      )}
      {fieldErrors.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {fieldErrors.map((m, i) => (
            <li key={i}>• {m}</li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => void onSave()}
            disabled={patch.isPending}
          >
            {patch.isPending ? "Saving…" : "Save draft"}
          </Button>
          {savedAt && !patch.isPending && (
            <span className="text-xs text-muted-foreground">Saved.</span>
          )}
        </div>
      )}
    </section>
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

/**
 * One per-product card — same shape as the batch creation page's
 * ProductRow. Owner picks meat type + product name + slaughter +
 * (optional) supplier and cert info; multiple products under a
 * single meat type are expected.
 */
function ProductRow({
  value,
  onChange,
  onRemove,
}: {
  value: MeatProductSourcing;
  onChange: (patch: Partial<MeatProductSourcing>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          aria-label="Meat type"
          className="flex h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          value={value.meat_type}
          onChange={(e) =>
            onChange({ meat_type: e.target.value as MeatType })
          }
        >
          {MEAT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <Input
          type="text"
          aria-label="Product name"
          placeholder="Product (e.g. Beef bacon, Ground beef)"
          value={value.product_name}
          onChange={(e) => onChange({ product_name: e.target.value })}
          maxLength={255}
        />
      </div>
      <select
        aria-label="Slaughter method"
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        value={value.slaughter_method}
        onChange={(e) =>
          onChange({
            slaughter_method: e.target.value as SlaughterMethod,
          })
        }
      >
        {SLAUGHTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <Input
        type="text"
        aria-label="Supplier name"
        placeholder="Supplier name (optional)"
        value={value.supplier_name ?? ""}
        onChange={(e) =>
          onChange({ supplier_name: e.target.value || null })
        }
        maxLength={255}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          type="text"
          aria-label="Supplier city"
          placeholder="Supplier city (optional)"
          value={value.supplier_city ?? ""}
          onChange={(e) =>
            onChange({ supplier_city: e.target.value || null })
          }
          maxLength={120}
        />
        <Input
          type="text"
          aria-label="Supplier state"
          placeholder="Supplier state (optional)"
          value={value.supplier_state ?? ""}
          onChange={(e) =>
            onChange({ supplier_state: e.target.value || null })
          }
          maxLength={120}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <CertifyingAuthoritySelect
          ariaLabel="Certifying authority"
          value={value.certifying_authority ?? null}
          onChange={(next) => onChange({ certifying_authority: next })}
        />
        <Input
          type="text"
          aria-label="Certificate number"
          placeholder="Cert number (optional)"
          value={value.certificate_number ?? ""}
          onChange={(e) =>
            onChange({ certificate_number: e.target.value || null })
          }
          maxLength={255}
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachments section
// ---------------------------------------------------------------------------
function AttachmentsSection({
  claim,
  editable,
}: {
  claim: MyHalalClaimRead;
  editable: boolean;
}) {
  const upload = useUploadMyHalalClaimAttachment();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [docType, setDocType] = React.useState<HalalClaimAttachmentType>(
    "HALAL_CERTIFICATE",
  );
  // ``null`` = "None / not certified" (the dropdown's default).
  // Curated authority strings round-trip verbatim; "Other" lands as
  // whatever free text the owner typed.
  const [issuingAuthority, setIssuingAuthority] = React.useState<
    string | null
  >(null);
  const [certificateNumber, setCertificateNumber] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const atCap = claim.attachments.length >= MAX_FILES;

  async function handleFile(file: File) {
    setErrorMsg(null);
    if (atCap) {
      setErrorMsg(`Maximum ${MAX_FILES} files per claim.`);
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setErrorMsg(
        `${file.name}: file type not supported. Allowed: ${ALLOWED_HUMAN}.`,
      );
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMsg(
        `${file.name}: file is larger than ${
          MAX_FILE_SIZE_BYTES / 1024 / 1024
        } MB.`,
      );
      return;
    }
    try {
      await upload.mutateAsync({
        claimId: claim.id,
        file,
        document_type: docType,
        issuing_authority:
          docType === "HALAL_CERTIFICATE"
            ? (issuingAuthority?.trim() || null)
            : null,
        certificate_number:
          docType === "HALAL_CERTIFICATE"
            ? certificateNumber || null
            : null,
      });
      // Reset cert-only fields after a successful cert upload so a
      // second upload doesn't accidentally inherit the previous
      // metadata.
      if (docType === "HALAL_CERTIFICATE") {
        setIssuingAuthority(null);
        setCertificateNumber("");
      }
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: `Couldn't upload ${file.name}`,
      });
      setErrorMsg(description);
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Supporting documents</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Halal certificate, supplier letter, invoices showing meat
          provenance, photos of the certificate or kitchen — anything
          that helps Trust Halal staff verify your claim.
        </p>
      </div>

      {editable && (
        <div className="space-y-3 rounded-md border bg-background p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Document type">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={docType}
                onChange={(e) =>
                  setDocType(e.target.value as HalalClaimAttachmentType)
                }
              >
                {(
                  Object.keys(DOCUMENT_TYPE_LABELS) as HalalClaimAttachmentType[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            {docType === "HALAL_CERTIFICATE" && (
              <Field label="Issuing authority (optional)">
                <CertifyingAuthoritySelect
                  ariaLabel="Issuing authority"
                  value={issuingAuthority}
                  onChange={setIssuingAuthority}
                />
              </Field>
            )}
            {docType === "HALAL_CERTIFICATE" && (
              <Field label="Certificate number (optional)">
                <Input
                  type="text"
                  value={certificateNumber}
                  onChange={(e) => setCertificateNumber(e.target.value)}
                  maxLength={255}
                />
              </Field>
            )}
          </div>

          <div
            className={[
              "rounded-md border border-dashed bg-background px-4 py-6 text-center transition",
              atCap || upload.isPending ? "opacity-60" : "",
            ].join(" ")}
          >
            {atCap ? (
              <p className="text-sm text-muted-foreground">
                You&apos;ve reached the {MAX_FILES}-file limit for
                this claim.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={upload.isPending}
                  className="font-medium text-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed"
                >
                  Choose a file
                </button>{" "}
                to upload.
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {ALLOWED_HUMAN} · up to {MAX_FILE_SIZE_BYTES / 1024 / 1024}{" "}
              MB each · max {MAX_FILES} files
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif"
              className="hidden"
              disabled={!editable || atCap || upload.isPending}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  void handleFile(e.target.files[0]);
                }
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      {upload.isPending && (
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          Uploading…
        </p>
      )}
      {errorMsg && (
        <p
          role="alert"
          aria-live="polite"
          className="text-xs text-destructive"
        >
          {errorMsg}
        </p>
      )}

      {claim.attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No documents attached yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {claim.attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachmentRow({
  attachment,
}: {
  attachment: HalalClaimAttachmentRead;
}) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{attachment.original_filename}</p>
        <p className="text-xs text-muted-foreground">
          {DOCUMENT_TYPE_LABELS[attachment.document_type]} ·{" "}
          {attachment.content_type} · {formatBytes(attachment.size_bytes)}
        </p>
        {attachment.issuing_authority && (
          <p className="text-xs text-muted-foreground">
            Issued by {attachment.issuing_authority}
            {attachment.certificate_number &&
              ` · #${attachment.certificate_number}`}
          </p>
        )}
      </div>
    </li>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Submit section
// ---------------------------------------------------------------------------
function SubmitSection({ claim }: { claim: MyHalalClaimRead }) {
  const router = useRouter();
  const submit = useSubmitMyHalalClaim();
  const deleteClaim = useDeleteMyHalalClaim();
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<string[]>([]);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  // Two-step confirm: first click reveals the explicit "Yes,
  // delete" button rather than firing immediately. Inline state
  // beats a Dialog primitive here — the section is already a
  // bordered card, so the confirm fits naturally below the submit
  // button without a modal.
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  if (claim.status === "PENDING_REVIEW") {
    return (
      <section className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
        Submitted on{" "}
        {claim.submitted_at
          ? new Date(claim.submitted_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "an earlier date"}
        . Trust Halal staff will follow up by email when verification
        completes.
      </section>
    );
  }

  async function onSubmit() {
    if (submit.isPending) return;
    setErrorMsg(null);
    setFieldErrors([]);
    try {
      await submit.mutateAsync(claim.id);
    } catch (err) {
      // The strict re-validation on submit returns 400 with field-
      // level Pydantic errors under detail. Surface them.
      if (
        err instanceof ApiError &&
        err.code === "HALAL_CLAIM_QUESTIONNAIRE_INCOMPLETE"
      ) {
        const detail = err.detail;
        if (Array.isArray(detail)) {
          const messages: string[] = [];
          for (const item of detail) {
            if (
              typeof item === "object" &&
              item !== null &&
              "loc" in item &&
              "msg" in item
            ) {
              const loc = (item as { loc: unknown }).loc;
              const msg = (item as { msg: unknown }).msg;
              const path = Array.isArray(loc)
                ? loc.filter((p) => typeof p === "string").join(".")
                : "";
              messages.push(
                path ? `${path}: ${msg}` : String(msg),
              );
            }
          }
          if (messages.length > 0) {
            setFieldErrors(messages);
            setErrorMsg(
              "Some answers are still missing. Fill them in above and try again.",
            );
            return;
          }
        }
        setErrorMsg(err.message);
        return;
      }
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't submit your halal claim",
      });
      setErrorMsg(description);
    }
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-5">
      <h2 className="text-lg font-semibold">Ready to submit?</h2>
      <p className="text-sm text-muted-foreground">
        Submitting flips this claim to <strong>Pending review</strong>.
        Trust Halal staff will check your answers and evidence; you
        can&apos;t edit while review is in progress.
      </p>
      {errorMsg && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-destructive"
        >
          {errorMsg}
        </p>
      )}
      {fieldErrors.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {fieldErrors.map((m, i) => (
            <li key={i}>• {m}</li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        onClick={() => void onSubmit()}
        disabled={submit.isPending}
      >
        {submit.isPending ? "Submitting…" : "Submit for review"}
      </Button>

      {/* Discard-draft escape hatch. Only renders for DRAFT (the
          surrounding component is gated to non-PENDING_REVIEW
          and DRAFT is the only other status that lands here in
          practice). Two-step confirm to make accidental clicks
          recoverable. */}
      <div className="border-t pt-3">
        {!confirmingDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setConfirmingDelete(true);
              setDeleteError(null);
            }}
            disabled={submit.isPending || deleteClaim.isPending}
          >
            Discard this draft
          </Button>
        ) : (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="text-destructive">
              <strong>Discard this draft?</strong>
              {claim.attachments.length > 0 ? (
                <>
                  {" "}
                  This will also delete{" "}
                  {claim.attachments.length} attached file
                  {claim.attachments.length === 1 ? "" : "s"}.
                </>
              ) : null}{" "}
              The draft can&apos;t be recovered after this — you&apos;ll
              need to start a new claim.
            </p>
            {deleteError && (
              <p role="alert" className="text-xs text-destructive">
                {deleteError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  setDeleteError(null);
                  try {
                    await deleteClaim.mutateAsync(claim.id);
                    router.replace("/my-halal-claims");
                  } catch (err) {
                    const { description } = friendlyApiError(err, {
                      defaultTitle: "Couldn't discard the draft",
                      overrides: {
                        HALAL_CLAIM_NOT_DELETABLE: {
                          title: "Already submitted",
                          description:
                            "This claim has already been submitted for review and can no longer be discarded.",
                        },
                      },
                    });
                    setDeleteError(description);
                  }
                }}
                disabled={deleteClaim.isPending}
              >
                {deleteClaim.isPending ? "Discarding…" : "Yes, discard"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError(null);
                }}
                disabled={deleteClaim.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
