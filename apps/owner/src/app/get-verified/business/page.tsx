"use client";

/**
 * `/get-verified` — Stage 1: register your business.
 *
 * Parallel restyle of the existing create-org + org-detail flow into
 * the onboarding wizard shell. The proven wiring is copied verbatim:
 *
 *   * Create the legal entity at DRAFT (`useCreateMyOrganization`) —
 *     or resume the most-recent DRAFT if the owner already started
 *     one (the hub's "Resume" link lands here).
 *   * Stage formation-doc files in browser memory (same PDF/JPEG/PNG/
 *     HEIC + 10 MB + max-10 constraints as the org-detail page).
 *   * On submit: persist field edits, upload each staged file
 *     (`useUploadMyOrganizationAttachment`) sequentially, then submit
 *     (`useSubmitMyOrganization`) to flip DRAFT → UNDER_REVIEW.
 *
 * At least one document is required before submit — the same gate the
 * server enforces. On success we return to the hub, which now shows
 * stage 1 "in review" and unlocks stage 2.
 */

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type MyOrganizationRead,
  useCreateMyOrganization,
  useMyOrganizations,
  usePatchMyOrganization,
  useSubmitMyOrganization,
  useUploadMyOrganizationAttachment,
} from "@/lib/api/hooks";
import { US_STATES } from "@/lib/us-states";

import { FileDrop, stageFiles } from "../_components/file-drop";
import { type RailStage, WizardShell } from "../_components/wizard";

// Country is locked to US for v1 — same constant the existing org
// pages ship, so a future multi-country change is one edit.
const DEFAULT_COUNTRY_CODE = "US";
const MAX_FILES_PER_ORG = 10;

const RAIL: RailStage[] = [
  { title: "Register your business", sub: "In progress", state: "now" },
  { title: "Claim your restaurant", sub: "Locked", state: "lock" },
  { title: "Confirm halal details", sub: "Locked", state: "lock" },
];

export default function BusinessStagePage() {
  const orgs = useMyOrganizations();

  // Resume the most-recent DRAFT if one exists (the hub's "Resume"
  // CTA). Otherwise we create a fresh org on submit.
  const draftOrg = React.useMemo(() => {
    const drafts = (orgs.data ?? [])
      .filter((o) => o.status === "DRAFT")
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    return drafts[0] ?? null;
  }, [orgs.data]);

  if (orgs.isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Key on the resumed org id (or "new") so the form re-initialises
  // its state when the underlying draft resolves.
  return <BusinessForm key={draftOrg?.id ?? "new"} draftOrg={draftOrg} />;
}

function BusinessForm({ draftOrg }: { draftOrg: MyOrganizationRead | null }) {
  const router = useRouter();
  const create = useCreateMyOrganization();
  const patch = usePatchMyOrganization();
  const upload = useUploadMyOrganizationAttachment();
  const submit = useSubmitMyOrganization();

  const [name, setName] = React.useState(draftOrg?.name ?? "");
  const [contactEmail, setContactEmail] = React.useState(
    draftOrg?.contact_email ?? "",
  );
  const [address, setAddress] = React.useState(draftOrg?.address ?? "");
  const [city, setCity] = React.useState(draftOrg?.city ?? "");
  const [region, setRegion] = React.useState(draftOrg?.region ?? "");
  const [postalCode, setPostalCode] = React.useState(
    draftOrg?.postal_code ?? "",
  );

  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<string | null>(null);

  const existingAttachments = draftOrg?.attachments.length ?? 0;
  const docCount = existingAttachments + pendingFiles.length;

  const trimmed = {
    name: name.trim(),
    email: contactEmail.trim(),
    address: address.trim(),
    city: city.trim(),
    postal: postalCode.trim(),
  };
  const fieldsComplete =
    trimmed.name.length > 0 &&
    trimmed.email.length > 0 &&
    trimmed.address.length > 0 &&
    trimmed.city.length > 0 &&
    region.length > 0 &&
    trimmed.postal.length > 0;

  const busy = create.isPending || patch.isPending || upload.isPending || submit.isPending;
  const canSubmit = fieldsComplete && docCount > 0 && !busy;

  function addFiles(incoming: FileList | File[]) {
    const { files, error } = stageFiles({
      incoming,
      current: pendingFiles,
      maxFiles: MAX_FILES_PER_ORG,
      existingCount: existingAttachments,
    });
    setPendingFiles(files);
    setFileError(error);
  }

  function removeFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setErrorMsg(null);
    setProgress(null);

    // Step 1 — persist the entity. Resume path patches the existing
    // draft; fresh path creates a new one.
    let orgId: string;
    try {
      if (draftOrg) {
        await patch.mutateAsync({
          organizationId: draftOrg.id,
          patch: {
            name: trimmed.name,
            contact_email: trimmed.email,
            address: trimmed.address,
            city: trimmed.city,
            region,
            country_code: DEFAULT_COUNTRY_CODE,
            postal_code: trimmed.postal,
          },
        });
        orgId = draftOrg.id;
      } else {
        const created = await create.mutateAsync({
          name: trimmed.name,
          contact_email: trimmed.email,
          address: trimmed.address,
          city: trimmed.city,
          region,
          country_code: DEFAULT_COUNTRY_CODE,
          postal_code: trimmed.postal,
        });
        orgId = created.id;
      }
    } catch (err) {
      // NO_FIELDS surfaces when a resume-patch is a no-op (nothing
      // changed) — harmless, keep going with the existing id.
      if (
        draftOrg &&
        err instanceof ApiError &&
        err.code === "NO_FIELDS"
      ) {
        orgId = draftOrg.id;
      } else {
        const { description } = friendlyApiError(err, {
          defaultTitle: "Couldn't save your business",
        });
        setErrorMsg(
          err instanceof ApiError && err.status >= 500
            ? "Something went wrong on our end. Please try again in a moment."
            : description,
        );
        return;
      }
    }

    // Step 2 — upload staged formation docs sequentially so a partial
    // failure leaves a clear "we got this far" state.
    if (pendingFiles.length > 0) {
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        setProgress(`Uploading ${i + 1} of ${pendingFiles.length}…`);
        try {
          await upload.mutateAsync({ organizationId: orgId, file });
        } catch (err) {
          const { description } = friendlyApiError(err, {
            defaultTitle: `Couldn't upload ${file.name}`,
          });
          setErrorMsg(
            `${description} (${i} of ${pendingFiles.length} uploaded before this one failed).`,
          );
          setProgress(null);
          // Drop the uploaded ones from the queue so a retry doesn't
          // double-upload.
          setPendingFiles((prev) => prev.slice(i));
          return;
        }
      }
      setPendingFiles([]);
      setProgress(null);
    }

    // Step 3 — flip DRAFT → UNDER_REVIEW.
    try {
      await submit.mutateAsync(orgId);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't submit your business",
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
        title="Register your business"
        lead="The legal entity that operates your restaurant. This is a one-time verification — every location you claim later rolls up under it."
        footer={
          <>
            <span className="text-xs text-muted-foreground">
              {draftOrg ? "Resuming your draft" : "Step 1 of 3"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/get-verified")}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {busy ? "Submitting…" : "Submit for review"}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="gv-org-name">Legal business name</Label>
            <Input
              id="gv-org-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
              autoFocus
              disabled={busy}
              placeholder="e.g. Amir's Kitchen LLC"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gv-org-email">Contact email</Label>
              <Input
                id="gv-org-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                disabled={busy}
                placeholder="contact@yourrestaurant.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gv-org-address">Street address</Label>
              <Input
                id="gv-org-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={500}
                disabled={busy}
                placeholder="2118 Peachtree Rd NE"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="gv-org-city">City</Label>
              <Input
                id="gv-org-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                maxLength={120}
                disabled={busy}
                placeholder="Atlanta"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gv-org-region">State</Label>
              <select
                id="gv-org-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={busy}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>
                  Select…
                </option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gv-org-postal">Postal</Label>
              <Input
                id="gv-org-postal"
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                maxLength={20}
                disabled={busy}
                placeholder="30309"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Formation documents</Label>
            <p className="text-xs text-muted-foreground">
              Articles of organization, certificate of formation, or EIN
              letter — at least one is required. Files stay on this device
              until you submit.
            </p>
            {existingAttachments > 0 && (
              <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {existingAttachments} document
                {existingAttachments === 1 ? "" : "s"} already uploaded on
                this draft.
              </p>
            )}
            <FileDrop
              files={pendingFiles}
              onAdd={addFiles}
              onRemove={removeFile}
              disabled={busy}
              error={fileError}
              maxFiles={MAX_FILES_PER_ORG}
            />
            {docCount === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                ⚠ At least one document is required to submit.
              </p>
            )}
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
