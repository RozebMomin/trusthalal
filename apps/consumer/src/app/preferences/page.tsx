"use client";

/**
 * /preferences — saved consumer search defaults.
 *
 * The form mirrors the search-page filter panel shape (validation
 * tier radios + menu posture radios + boolean chips) so the user's
 * mental model carries over: "the same knobs I tweak per-search,
 * but persisted as my default."
 *
 * Persistence is split:
 *   * Signed-in CONSUMER → saves to the server via PUT
 *     /me/preferences. The hook auto-detects that and falls back to
 *     localStorage when the visitor is anonymous.
 *   * Anonymous → saves to localStorage. On signup/login the
 *     ``syncLocalToServerOnLogin`` helper migrates the local copy.
 *   * Owner / admin / verifier → the page surface is hidden via the
 *     header link; if they navigate here directly we render a
 *     polite "this surface is consumer-only" notice.
 *
 * Reset semantics: "Reset all" sends an empty PUT (server) or
 * clears localStorage (anonymous), restoring "no preferences" so
 * the search page is back to the unfiltered default.
 */

import { Save, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/api/hooks";
import {
  type ConsumerPreferences,
  type ConsumerPreferencesUpdate,
  EMPTY_PREFERENCES,
  useMyPreferences,
  useUpdatePreferences,
} from "@/lib/api/preferences";
import type {
  MenuPosture,
  ValidationTier,
} from "@/lib/api/hooks";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { cn } from "@/lib/utils";

const VALIDATION_TIER_OPTIONS: ReadonlyArray<{
  value: ValidationTier;
  label: string;
  description: string;
}> = [
  {
    value: "SELF_ATTESTED",
    label: "Any verified",
    description:
      "Owner-attested, certificate on file, or verifier-confirmed.",
  },
  {
    value: "CERTIFICATE_ON_FILE",
    label: "Certificate on file or higher",
    description:
      "Owner has a current cert, or a verifier confirmed in person.",
  },
  {
    value: "TRUST_HALAL_VERIFIED",
    label: "Verifier-confirmed only",
    description:
      "A Trust Halal verifier physically visited and confirmed.",
  },
];

const MENU_POSTURE_OPTIONS: ReadonlyArray<{
  value: MenuPosture;
  label: string;
}> = [
  { value: "FULLY_HALAL", label: "Fully halal only" },
  {
    value: "MIXED_SEPARATE_KITCHENS",
    label: "Includes separate halal kitchens",
  },
  {
    value: "HALAL_OPTIONS_ADVERTISED",
    label: "Includes halal-options menus",
  },
  { value: "HALAL_UPON_REQUEST", label: "Includes halal-on-request" },
  { value: "MIXED_SHARED_KITCHEN", label: "Any halal options" },
];

export default function PreferencesPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const isAuthenticated = Boolean(me);
  const isConsumerOrAnon = me === null || me === undefined || me?.role === "CONSUMER";

  const prefsQuery = useMyPreferences({ isAuthenticated });
  const updatePrefs = useUpdatePreferences({ isAuthenticated });

  // Local "draft" state seeded from the server/local read. Lets the
  // user tweak multiple fields and save in one shot — same pattern
  // as the admin panel's edit dialogs.
  const [draft, setDraft] = React.useState<ConsumerPreferences>(EMPTY_PREFERENCES);
  const [saved, setSaved] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (prefsQuery.data) {
      setDraft(prefsQuery.data);
    }
  }, [prefsQuery.data]);

  if (meLoading || prefsQuery.isLoading) {
    return <Loading />;
  }

  if (!isConsumerOrAnon) {
    return <WrongAudienceNotice />;
  }

  function setField<K extends keyof ConsumerPreferencesUpdate>(
    key: K,
    value: ConsumerPreferencesUpdate[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setErrorMsg(null);
  }

  async function onSave() {
    setSaved(false);
    setErrorMsg(null);
    try {
      await updatePrefs.mutateAsync({
        min_validation_tier: draft.min_validation_tier,
        min_menu_posture: draft.min_menu_posture,
        no_pork: draft.no_pork,
        no_alcohol_served: draft.no_alcohol_served,
        has_certification: draft.has_certification,
      });
      setSaved(true);
    } catch (err) {
      const friendly = friendlyApiError(err, {
        defaultTitle: "Couldn't save preferences",
      });
      setErrorMsg(`${friendly.title}. ${friendly.description}`);
    }
  }

  async function onReset() {
    setSaved(false);
    setErrorMsg(null);
    try {
      await updatePrefs.mutateAsync({
        min_validation_tier: null,
        min_menu_posture: null,
        no_pork: null,
        no_alcohol_served: null,
        has_certification: null,
      });
      setDraft(EMPTY_PREFERENCES);
      setSaved(true);
    } catch (err) {
      const friendly = friendlyApiError(err, {
        defaultTitle: "Couldn't reset preferences",
      });
      setErrorMsg(`${friendly.title}. ${friendly.description}`);
    }
  }

  const persistedAt = prefsQuery.data?.updated_at ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2 pt-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Search preferences
        </h1>
        <p className="text-muted-foreground">
          Set your default filters — the search page applies them
          automatically every time. The place detail page shows you
          which restaurants match your preferences.
        </p>
        {!isAuthenticated && (
          <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            You&rsquo;re not signed in. Preferences will be saved to
            this browser only.{" "}
            <Link href="/signup" className="underline">
              Sign up
            </Link>{" "}
            to sync them across devices.
          </p>
        )}
      </header>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">
            Minimum validation tier
          </legend>
          <p className="text-xs text-muted-foreground">
            Only show places verified at this level or stricter.
          </p>
          {VALIDATION_TIER_OPTIONS.map((opt) => {
            const checked = draft.min_validation_tier === opt.value;
            const id = `pref-tier-${opt.value}`;
            return (
              <label
                key={opt.value}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition",
                  checked
                    ? "border-foreground bg-accent/50"
                    : "hover:bg-accent/30",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name="pref-min-validation-tier"
                  value={opt.value}
                  checked={checked}
                  onChange={() => setField("min_validation_tier", opt.value)}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
              </label>
            );
          })}
          {draft.min_validation_tier !== null && (
            <button
              type="button"
              onClick={() => setField("min_validation_tier", null)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Clear validation tier preference
            </button>
          )}
        </fieldset>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">
            Minimum menu posture
          </legend>
          <p className="text-xs text-muted-foreground">
            Only show places that meet this menu-posture threshold.
          </p>
          {MENU_POSTURE_OPTIONS.map((opt) => {
            const checked = draft.min_menu_posture === opt.value;
            const id = `pref-posture-${opt.value}`;
            return (
              <label
                key={opt.value}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition",
                  checked
                    ? "border-foreground bg-accent/50"
                    : "hover:bg-accent/30",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name="pref-min-menu-posture"
                  value={opt.value}
                  checked={checked}
                  onChange={() => setField("min_menu_posture", opt.value)}
                  className="mt-0.5"
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
          {draft.min_menu_posture !== null && (
            <button
              type="button"
              onClick={() => setField("min_menu_posture", null)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Clear menu posture preference
            </button>
          )}
        </fieldset>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Other preferences</h2>
        <p className="text-xs text-muted-foreground">
          Toggle the dietary preferences you want filtered.
        </p>
        <div className="flex flex-wrap gap-2">
          <PrefToggle
            label="No pork"
            active={draft.no_pork === true}
            onClick={() =>
              setField("no_pork", draft.no_pork === true ? null : true)
            }
          />
          <PrefToggle
            label="No alcohol on premises"
            active={draft.no_alcohol_served === true}
            onClick={() =>
              setField(
                "no_alcohol_served",
                draft.no_alcohol_served === true ? null : true,
              )
            }
          />
          <PrefToggle
            label="Has certification on file"
            active={draft.has_certification === true}
            onClick={() =>
              setField(
                "has_certification",
                draft.has_certification === true ? null : true,
              )
            }
          />
        </div>
      </section>

      {errorMsg && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {errorMsg}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="text-xs text-muted-foreground">
          {saved && "Saved."}
          {!saved && persistedAt && (
            <>Last saved {formatTimestamp(persistedAt)}.</>
          )}
          {!saved && !persistedAt && "Not yet saved."}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            disabled={updatePrefs.isPending}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" /> Reset all
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={updatePrefs.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {updatePrefs.isPending ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PrefToggle({
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
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium transition",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-background hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function WrongAudienceNotice() {
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-2xl font-semibold">Search preferences</h1>
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Search preferences are a consumer feature. Your account
        type doesn&rsquo;t use the consumer search page, so there&rsquo;s
        nothing to save here.
      </p>
      <Link href="/" className="text-sm underline">
        Back to home
      </Link>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
