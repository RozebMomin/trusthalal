"use client";

/**
 * Public verifier recruitment page — the top of the community
 * flywheel. Explains what verifiers do, what we ask of them, and
 * hosts the application form inline.
 *
 * The verifier system (application backend, admin review, public
 * profiles) is already fully wired server-side. What was missing
 * was a public front door. This page is that front door.
 *
 * Not gated behind auth — the ``POST /verifier-applications``
 * endpoint accepts anonymous submissions. Signed-in users get
 * their user_id linked automatically server-side; anonymous
 * applicants get followed up on via the email they provide.
 *
 * Structure:
 *   1. Hero — what this is, primary CTA scrolls to form
 *   2. What is a verifier — explainer of the role
 *   3. What we ask — standards + expectations, including the
 *      disclosure norms that make the whole community trustworthy
 *   4. What you get — badge, profile page, comped meals, community
 *   5. Inline application form
 *   6. Success pane after submission
 *
 * Copy stays warm and community-focused per the brand voice guide.
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

// Motivation min-length mirrors the server-side schema
// (see api/app/modules/verifiers/schemas.py — Field(min_length=20)).
// Client validation is convenience only; server enforces independently.
const MOTIVATION_MIN_LENGTH = 20;
const MOTIVATION_MAX_LENGTH = 2000;
const BACKGROUND_MAX_LENGTH = 2000;

export default function BecomeAVerifierPage() {
  const { data: me } = useCurrentUser();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <Breadcrumb />

      <Hero />

      <WhatIsAVerifier />

      <WhatWeAsk />

      <WhatYouGet />

      <DisclosureNorms />

      <div id="apply" className="scroll-mt-20 pt-8">
        <VerifierApplicationForm
          prefillEmail={me?.email ?? ""}
          prefillName={me?.display_name ?? ""}
        />
      </div>

      <ClosingNote />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Structural sections
// ---------------------------------------------------------------------------

function Breadcrumb() {
  return (
    <nav className="mb-6 text-sm text-muted-foreground">
      <Link href="/" className="hover:underline">
        Halal Food Near Me
      </Link>
      <span className="mx-2">·</span>
      <span>Become a verifier</span>
    </nav>
  );
}

function Hero() {
  return (
    <section className="mb-12">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
        Join the community verifier team
      </p>
      <h1 className="mb-4 font-serif text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
        Help the community find halal food it can trust.
      </h1>
      <p className="mb-6 text-lg text-muted-foreground sm:text-xl">
        Trust Halal Verifiers visit halal-claiming restaurants in
        person, check what&apos;s on the plate, and file honest
        reports. Your work is how a &ldquo;verified&rdquo; badge
        actually means something.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <a href="#apply">Apply to be a verifier</a>
        </Button>
        <Button asChild variant="outline" size="lg">
          <a href="#what-is">What does a verifier do?</a>
        </Button>
      </div>
    </section>
  );
}

function WhatIsAVerifier() {
  return (
    <section id="what-is" className="mb-12 scroll-mt-20">
      <h2 className="mb-4 font-serif text-2xl font-semibold sm:text-3xl">
        What is a Trust Halal Verifier?
      </h2>
      <div className="space-y-4 text-base text-muted-foreground sm:text-lg">
        <p>
          Verifiers are vetted community members &mdash; food bloggers,
          mosque-affiliated reviewers, active platform users &mdash; who
          do the in-person work of confirming what restaurants say
          about themselves. When a restaurant tells us their chicken is
          zabihah, verifiers eat there, see the kitchen when welcomed,
          and file a report about what they actually saw.
        </p>
        <p>
          You don&apos;t need a formal food background. You need to
          care about the community, be willing to visit places
          (usually anonymously), and file an honest, specific report
          within a week of your visit.
        </p>
      </div>
    </section>
  );
}

function WhatWeAsk() {
  return (
    <section className="mb-12">
      <h2 className="mb-4 font-serif text-2xl font-semibold sm:text-3xl">
        What we ask of you
      </h2>
      <ul className="space-y-3 text-base text-muted-foreground sm:text-lg">
        <ListItem title="1 verified visit per month, minimum">
          Verifier visits are the source of truth for the top trust
          tier. If you can&apos;t sustain a visit a month, this
          isn&apos;t the right role for you right now.
        </ListItem>
        <ListItem title="Report within 7 days of the visit">
          Menu photos, notes on menu posture, per-meat sourcing
          observations, alcohol on premises. The report form is
          structured &mdash; you fill in what you saw, not a review.
        </ListItem>
        <ListItem title="Full disclosure of any compensation">
          Comped meal, paid partnership, invited-guest &mdash; all get
          declared on the visit. Not disqualifying, just non-negotiable
          to declare. See below for how this works.
        </ListItem>
        <ListItem title="No promoting yourself off the platform">
          Your Trust Halal Verifier badge is for the community, not for
          driving traffic to your food blog. You can link your socials
          from your profile, but the verifier role isn&apos;t for
          growing a personal brand at the community&apos;s expense.
        </ListItem>
      </ul>
    </section>
  );
}

function WhatYouGet() {
  return (
    <section className="mb-12">
      <h2 className="mb-4 font-serif text-2xl font-semibold sm:text-3xl">
        What you get
      </h2>
      <ul className="space-y-3 text-base text-muted-foreground sm:text-lg">
        <ListItem title="A public Trust Halal Verifier profile">
          Your handle, bio, and every visit you&apos;ve filed live at
          halalfoodnearme.com/verifiers/[your-handle]. Link to it from
          Instagram, your blog, anywhere.
        </ListItem>
        <ListItem title="The Trust Halal Verifier badge">
          A distinct badge (visually different from the restaurant
          Verified badge) you can put in your IG bio, YouTube description,
          website footer.
        </ListItem>
        <ListItem title="Direct influence on which restaurants get verified">
          Verifiers can nominate restaurants they want to check. Your
          nominations move up our outreach queue &mdash; the community
          decides where we grow next.
        </ListItem>
        <ListItem title="A tight-knit community of other verifiers">
          Private group chat with the other verifiers in your city,
          quarterly meetups (in-person or virtual), first-look at
          platform decisions we&apos;re considering.
        </ListItem>
      </ul>
    </section>
  );
}

function DisclosureNorms() {
  return (
    <section className="mb-12 rounded-lg border border-primary/20 bg-primary/5 p-6 sm:p-8">
      <h2 className="mb-4 font-serif text-2xl font-semibold sm:text-3xl">
        Disclosure &mdash; the part that matters most
      </h2>
      <p className="mb-4 text-base text-muted-foreground sm:text-lg">
        The whole platform&apos;s credibility rests on verifiers being
        honest about their relationship to the places they visit. Every
        visit report asks you to declare one of four disclosure levels:
      </p>
      <dl className="space-y-3 text-sm sm:text-base">
        <div>
          <dt className="font-semibold text-foreground">Self-funded</dt>
          <dd className="text-muted-foreground">
            You paid for the meal out of pocket. The default and
            highest-trust scenario.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground">Meal comped</dt>
          <dd className="text-muted-foreground">
            The restaurant knew you were coming and covered the meal.
            Not disqualifying &mdash; but the disclosure is required
            so admin can weigh accordingly.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground">Paid partnership</dt>
          <dd className="text-muted-foreground">
            You&apos;re in a paid sponsorship with the restaurant.
            Flagged for extra scrutiny. Should be rare.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-foreground">Other</dt>
          <dd className="text-muted-foreground">
            Any other relationship worth flagging &mdash; family friend
            owns the place, you&apos;ve been going for years, etc.
            Explain briefly in the visit&apos;s disclosure note.
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm text-muted-foreground">
        Undisclosed compensation, discovered after the fact, is grounds
        for immediate removal from the verifier program.
      </p>
    </section>
  );
}

function ClosingNote() {
  return (
    <section className="mt-12 border-t border-border pt-8 text-center">
      <p className="text-sm text-muted-foreground">
        Questions before applying?{" "}
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
// Reusable pieces
// ---------------------------------------------------------------------------

function ListItem({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-md border border-border bg-card p-4">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground sm:text-base">
        {children}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The application form itself
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

  // If the /me query resolves later, pull those defaults into the
  // fields — but only while they're still untouched. Feels like a
  // helpful autofill without silently overwriting typed input.
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

    // Build the social_links dict — only include keys the applicant
    // actually filled in so the server stores a clean payload.
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
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
    }
  }

  if (submittedEmail) {
    return <SuccessPane email={submittedEmail} />;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6 sm:p-8">
      <h2 className="mb-2 font-serif text-2xl font-semibold sm:text-3xl">
        Apply to be a verifier
      </h2>
      <p className="mb-6 text-sm text-muted-foreground sm:text-base">
        Takes about 5 minutes. We review every application by hand,
        usually within a week. If your fit is clear, we&apos;ll invite
        you to the verifier team.
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
              placeholder="First and last name"
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
            Why do you want to be a verifier?
            <span className="text-destructive"> *</span>
          </Label>
          <Textarea
            id="motivation"
            value={form.motivation}
            onChange={(e) => update("motivation", e.target.value)}
            placeholder="Tell us about you, your relationship with halal food, and why this matters to you. A few sentences is fine."
            rows={5}
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
                : "A few honest sentences beats a polished pitch."}
            </span>
            <span>
              {motivationChars}/{MOTIVATION_MAX_LENGTH}
            </span>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="background">
            Background <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="background"
            value={form.background}
            onChange={(e) => update("background", e.target.value)}
            placeholder="Anything else about your background that might be relevant — food-writing experience, community organizing, mosque involvement, etc."
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
            Share any of your public accounts so we can get a feel for
            your voice. Handles or full URLs both work.
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
            By submitting you agree we may contact you at the email
            provided. We won&apos;t share your info.
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
      <h2 className="mb-2 font-serif text-2xl font-semibold sm:text-3xl">
        Application received
      </h2>
      <p className="mb-4 text-base text-muted-foreground sm:text-lg">
        Thanks &mdash; we&apos;ve got it. We&apos;ll be in touch at{" "}
        <span className="font-medium text-foreground">{email}</span>{" "}
        within a week either way.
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        In the meantime, if you&apos;d like to see the verified
        restaurants your work would contribute to, browse the directory:
      </p>
      <Button asChild variant="outline">
        <Link href="/">Browse verified restaurants</Link>
      </Button>
    </section>
  );
}
