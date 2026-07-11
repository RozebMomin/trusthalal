"use client";

/**
 * Verifier profile edit page.
 *
 * The only self-serve edit surface for the verifier's public
 * identity — handle (URL slug), bio, social links, and the
 * public-visibility toggle. Status changes (SUSPEND, REVOKE) are
 * admin-only and live on the admin surface.
 *
 * Handle validation mirrors the server: url-safe slug (lowercase
 * alphanumeric, hyphens, underscores). Bio and socials are free-text.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  type VerifierProfilePatch,
  useUpdateVerifierProfile,
  useVerifierProfile,
} from "@/lib/api/hooks";

const HANDLE_PATTERN = /^[a-z0-9_-]{3,80}$/;

type FormState = {
  public_handle: string;
  bio: string;
  is_public: boolean;
  instagram: string;
  tiktok: string;
  youtube: string;
  website: string;
};

export default function VerifierProfilePage() {
  const { data: profile, isLoading } = useVerifierProfile();
  const update = useUpdateVerifierProfile();

  const [form, setForm] = React.useState<FormState | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);

  // Hydrate the form once the profile query resolves. Do it via
  // useEffect so the field values track the server truth on first
  // paint.
  React.useEffect(() => {
    if (profile && form === null) {
      const socials = (profile.social_links ?? {}) as Record<string, string>;
      setForm({
        public_handle: profile.public_handle ?? "",
        bio: profile.bio ?? "",
        is_public: profile.is_public,
        instagram: socials.instagram ?? "",
        tiktok: socials.tiktok ?? "",
        youtube: socials.youtube ?? "",
        website: socials.website ?? "",
      });
    }
  }, [profile, form]);

  if (isLoading || !form) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-muted-foreground">Loading your profile…</p>
      </main>
    );
  }

  function update_<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (errorMsg) setErrorMsg(null);
    if (savedAt) setSavedAt(null);
  }

  const handleValid = !form.public_handle || HANDLE_PATTERN.test(form.public_handle);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || update.isPending) return;
    setErrorMsg(null);

    if (form.public_handle && !HANDLE_PATTERN.test(form.public_handle)) {
      setErrorMsg(
        "Handle must be 3–80 characters, lowercase letters, numbers, hyphens, or underscores only.",
      );
      return;
    }

    const socials: Record<string, string> = {};
    if (form.instagram.trim()) socials.instagram = form.instagram.trim();
    if (form.tiktok.trim()) socials.tiktok = form.tiktok.trim();
    if (form.youtube.trim()) socials.youtube = form.youtube.trim();
    if (form.website.trim()) socials.website = form.website.trim();

    const payload: VerifierProfilePatch = {
      public_handle: form.public_handle.trim() || null,
      bio: form.bio.trim() || null,
      is_public: form.is_public,
      social_links: Object.keys(socials).length > 0 ? socials : null,
    };

    try {
      await update.mutateAsync(payload);
      setSavedAt(new Date());
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't save your profile",
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
        <span>Edit profile</span>
      </nav>

      <h1 className="mb-2 tracking-tight text-3xl font-semibold sm:text-4xl">
        Your verifier profile
      </h1>
      <p className="mb-8 text-muted-foreground">
        This is what the community sees when they visit your public
        profile page. Keep it honest and specific — the point is to
        establish who you are and why your visits are trustworthy.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="public_handle">
            Public handle{" "}
            <span className="text-muted-foreground">
              (your URL slug — e.g. yasmeen-eats)
            </span>
          </Label>
          <Input
            id="public_handle"
            value={form.public_handle}
            onChange={(e) =>
              update_("public_handle", e.target.value.toLowerCase())
            }
            placeholder="your-handle"
            maxLength={80}
            aria-invalid={!handleValid}
          />
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, hyphens, or underscores. Your
            public profile will live at{" "}
            <code className="font-mono">/verifiers/{form.public_handle || "your-handle"}</code>
            .
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            value={form.bio}
            onChange={(e) => update_("bio", e.target.value)}
            placeholder="A few sentences about you — where you're based, your relationship with halal food, why you do this work."
            rows={4}
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground">
            {form.bio.length}/2000
          </p>
        </div>

        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-2 text-sm font-semibold text-foreground">
            Social links
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="instagram" className="text-xs">
                Instagram
              </Label>
              <Input
                id="instagram"
                value={form.instagram}
                onChange={(e) => update_("instagram", e.target.value)}
                placeholder="@yourhandle"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tiktok" className="text-xs">
                TikTok
              </Label>
              <Input
                id="tiktok"
                value={form.tiktok}
                onChange={(e) => update_("tiktok", e.target.value)}
                placeholder="@yourhandle"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="youtube" className="text-xs">
                YouTube
              </Label>
              <Input
                id="youtube"
                value={form.youtube}
                onChange={(e) => update_("youtube", e.target.value)}
                placeholder="Channel URL"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="website" className="text-xs">
                Website / blog
              </Label>
              <Input
                id="website"
                value={form.website}
                onChange={(e) => update_("website", e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
        </fieldset>

        <div className="flex items-start gap-3 rounded-md border border-border p-4">
          <input
            id="is_public"
            type="checkbox"
            checked={form.is_public}
            onChange={(e) => update_("is_public", e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-border text-primary"
          />
          <div>
            <Label htmlFor="is_public" className="cursor-pointer">
              Make my profile public
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              When on, anyone visiting <code className="font-mono">/verifiers/{form.public_handle || "your-handle"}</code>{" "}
              sees your bio, socials, and accepted visits. When off,
              your visits are still linked in the audit trail but your
              page returns a 404.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errorMsg}
          </div>
        )}

        {savedAt && !errorMsg && (
          <div
            role="status"
            className="rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900"
          >
            Saved at {savedAt.toLocaleTimeString()}.
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Button asChild variant="outline" type="button">
            <Link href="/verifier">Back to dashboard</Link>
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </main>
  );
}
