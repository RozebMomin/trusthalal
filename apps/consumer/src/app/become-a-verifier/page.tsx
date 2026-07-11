"use client";

/**
 * Public verifier recruitment page.
 *
 * Tightened v2. The previous version had five explainer sections
 * before the form and readers were bouncing without applying. This
 * version is: friendly hero → three-tile "here's the deal" grid →
 * disclosure callout (kept short but present — non-negotiable for
 * the trust posture) → form.
 *
 * The disclosure section stays because verifier credibility is the
 * whole point; without it we're just a review app. Everything else
 * got cut or compressed.
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
  type VerifierApplicationCreate,
  useApplyAsVerifier,
  useCurrentUser,
} from "@/lib/api/hooks";

// Mirrors ``Field(min_length=20)`` on the server-side schema.
const MOTIVATION_MIN_LENGTH = 20;
const MOTIVATION_MAX_LENGTH = 2000;
const BACKGROUND_MAX_LENGTH = 2000;

export default function BecomeAVerifierPage() {
  const { data: me } = useCurrentUser();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <Hero />
      <HowItWorks />
      <DisclosureCallout />
      <div id="apply" className="scroll-mt-20 pt-2">
        <VerifierApplicationForm
          prefillEmail={me?.email ?? ""}
          prefillName={me?.display_name ?? ""}
        />
      </div>
      <FooterHelp />
    </main>
  );
}

function Hero() {
  return (
    <section className="mb-10">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
        Join the verifier team
      </p>
      <h1 className="mb-4 tracking-tight text-4xl font-semibold leading-tight sm:text-5xl">
        Eat halal. Help your community trust where they eat.
      </h1>
      <p className="mb-6 text-lg text-muted-foreground sm:text-xl">
        You visit halal restaurants anyway. As a Trust Halal Verifier,
        you file a short honest report on each one — and your name
        helps the community trust the listing.
      </p>
      <Button asChild size="lg">
        <a href="#apply">Apply — takes 5 minutes</a>
      </Button>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="mb-10 grid gap-4 sm:grid-cols-3">
      <Tile
        title="One visit a month"
        body="Go eat somewhere halal. That's the visit. No performance required."
      />
      <Tile
        title="Short honest report"
        body="A few notes on menu posture, cert on the wall, meat sourcing you saw. 10 minutes tops."
      />
      <Tile
        title="Your public page"
        body="Your handle, bio, and every accepted visit — link it from your Instagram bio."
      />
    </section>
  );
}

function Tile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function DisclosureCallout() {
  return (
    <section className="mb-10 rounded-lg border border-primary/20 bg-primary/5 p-5 sm:p-6">
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary">
        The one non-negotiable
      </p>
      <p className="mb-2 text-base text-foreground">
        Every visit asks how you got the meal — you paid, it was
        comped, it was a paid partnership, or something else. Not
        disqualifying. Just required.
      </p>
      <p className="text-sm text-muted-foreground">
        Skipping the disclosure or hiding a paid arrangement is the
        one thing that gets you removed from the program.
      </p>
    </section>
  );
}

function FooterHelp() {
  return (
    <section className="mt-12 border-t border-border pt-6 text-center">
      <p className="text-sm text-muted-foreground">
        Questions?{" "}
        <a
          href="mailto:verifiers@trusthalal.org"
          className="font-medium text-foreground hover:underline"
        >
          verifiers@trusthalal.org
        </a>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Application form (unchanged shape; the wordy intro copy above the
// form is what got cut).
// ---------------------------------------------------------------------------

type FormState = {
  applicant_name: string;
  applicant_email: string;
  motivation: string;
  background: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  website: string;
};

const INITIAL_FORM: FormState = {
  applicant_name: "",
  applicant_email: "",
  motivation: "",
  background: "",
  instagram: "",
  tiktok: "",
  youtube: "",
  website: "",
};

function VerifierApplicationForm({
  prefillEmail,
  prefillName,
}: {
  prefillEmail: string;
  prefillName: string;
}) {
  const apply = useApplyAsVerifier();
  const [form, setForm] = React.useState<FormState>({
    ...INITIAL_FORM,
    applicant_email: prefillEmail,
    applicant_name: prefillName,
  });
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    setForm((prev) => ({
      ...prev,
      applicant_email: prev.applicant_email || prefillEmail,
      applicant_name: prev.applicant_name || prefillName,
    }));
  }, [prefillEmail, prefillName]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errorMsg) setErrorMsg(null);
  }

  const motivationChars = form.motivation.trim().length;
  const motivationTooShort =
    motivationChars > 0 && motivationChars < MOTIVATION_MIN_LENGTH;
  const formIncomplete =
    !form.applicant_name.trim() ||
    !form.applicant_email.trim() ||
    motivationChars < MOTIVATION_MIN_LENGTH;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (apply.isPending) return;
    setErrorMsg(null);

    const socialLinks: NonNullable<VerifierApplicationCreate["social_links"]> =
      {};
    if (form.instagram.trim()) socialLinks.instagram = form.instagram.trim();
    if (form.tiktok.trim()) socialLinks.tiktok = form.tiktok.trim();
    if (form.youtube.trim()) socialLinks.youtube = form.youtube.trim();
    if (form.website.trim()) socialLinks.website = form.website.trim();

    const payload: VerifierApplicationCreate = {
      applicant_name: form.applicant_name.trim(),
      applicant_email: form.applicant_email.trim(),
      motivation: form.motivation.trim(),
      background: form.background.trim() || null,
      social_links: Object.keys(socialLinks).length > 0 ? socialLinks : null,
    };

    try {
      await apply.mutateAsync(payload);
      setSubmittedEmail(payload.applicant_email);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't submit your application",
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Try again in a moment."
          : description,
      );
    }
  }

  if (submittedEmail) {
    return <SuccessPane email={submittedEmail} />;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <h2 className="mb-1 tracking-tight text-2xl font-semibold sm:text-3xl">
        Apply
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        We read every application. Usually respond within a week.
      </p>

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="applicant_name">
              Your name<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="applicant_name"
              value={form.applicant_name}
              onChange={(e) => update("applicant_name", e.target.value)}
              placeholder="First and last"
              maxLength={255}
              required
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="applicant_email">
              Email<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="applicant_email"
              type="email"
              value={form.applicant_email}
              onChange={(e) => update("applicant_email", e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="motivation">
            Why do you want to do this?
            <span className="text-destructive"> *</span>
          </Label>
          <Textarea
            id="motivation"
            value={form.motivation}
            onChange={(e) => update("motivation", e.target.value)}
            placeholder="A few honest sentences. Where you're based, what you eat, why this matters to you."
            rows={4}
            maxLength={MOTIVATION_MAX_LENGTH}
            required
            aria-describedby="motivation-help"
          />
          <p
            id="motivation-help"
            className="flex items-center justify-between text-xs text-muted-foreground"
          >
            <span>
              {motivationTooShort
                ? `At least ${MOTIVATION_MIN_LENGTH} characters`
                : "Honest beats polished."}
            </span>
            <span>
              {motivationChars}/{MOTIVATION_MAX_LENGTH}
            </span>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="background">
            Anything else about you?{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="background"
            value={form.background}
            onChange={(e) => update("background", e.target.value)}
            placeholder="Food-writing, mosque involvement, community organizing — anything relevant."
            rows={3}
            maxLength={BACKGROUND_MAX_LENGTH}
          />
        </div>

        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-2 text-sm font-semibold text-foreground">
            Social links{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </legend>
          <p className="text-xs text-muted-foreground">
            Any public accounts so we can get a feel for your voice.
            Handles or full URLs both work.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="instagram" className="text-xs">
                Instagram
              </Label>
              <Input
                id="instagram"
                value={form.instagram}
                onChange={(e) => update("instagram", e.target.value)}
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
                onChange={(e) => update("tiktok", e.target.value)}
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
                onChange={(e) => update("youtube", e.target.value)}
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
                onChange={(e) => update("website", e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
        </fieldset>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errorMsg}
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            By submitting you agree we may contact you at this email.
            We won&apos;t share it.
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={formIncomplete || apply.isPending}
          >
            {apply.isPending ? "Submitting…" : "Submit application"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SuccessPane({ email }: { email: string }) {
  return (
    <section
      className="rounded-lg border border-primary/40 bg-primary/5 p-8 text-center"
      role="status"
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <h2 className="mb-2 tracking-tight text-2xl font-semibold sm:text-3xl">
        Got it — thanks
      </h2>
      <p className="mb-4 text-base text-muted-foreground sm:text-lg">
        We&apos;ll be in touch at{" "}
        <span className="font-medium text-foreground">{email}</span>{" "}
        within a week.
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        In the meantime, browse what verified halal restaurants look
        like on the platform:
      </p>
      <Button asChild variant="outline">
        <Link href="/">Browse verified restaurants</Link>
      </Button>
    </section>
  );
}
