/**
 * /support — Trust Halal help & contact page.
 *
 * Required as the App Store / Play Store "Support URL". Server-rendered,
 * zero client JS, same brand system + document typography as /ethics and
 * /privacy. Keep the FAQ answers in sync with the actual app behavior.
 */

import type { Metadata } from "next";

import { Footer, Header } from "@/components/chrome";
import {
  CONSUMER_URL,
  DELETE_ACCOUNT_PATH,
  OWNER_GET_VERIFIED_URL,
  PRIVACY_PATH,
  SUPPORT_CONTACT_EMAIL,
  VERIFIER_URL,
} from "@/lib/links";

const PAGE_TITLE = "Support";
const PAGE_DESCRIPTION =
  "Get help with Trust Halal — how trust levels work, resetting your password, reporting a listing, becoming a verifier, and deleting your account.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/support" },
  openGraph: {
    type: "article",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/support",
  },
  twitter: { card: "summary", title: PAGE_TITLE, description: PAGE_DESCRIPTION },
};

export default function SupportPage() {
  return (
    <>
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 pt-8 sm:pt-10">
        <Header />
        <article className="prose-brand mx-auto mb-24 w-full max-w-2xl">
          <nav aria-label="Breadcrumb" className="mb-8 text-sm text-sub">
            <a href="/" className="hover:text-ink hover:underline">
              Trust Halal
            </a>
            <span className="mx-2">·</span>
            <span>Support</span>
          </nav>

          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Support
          </p>
          <h1 className="mb-6 tracking-tight text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            How can we help?
          </h1>
          <p className="mb-8 text-lg leading-relaxed text-sub sm:text-xl">
            Most questions are answered below. If you&apos;re still stuck, email
            us and a real person will get back to you.
          </p>

          <section className="my-10 rounded-2xl border border-accent/30 bg-accent/5 p-6 sm:p-7">
            <h2 className="mb-2 tracking-tight text-xl font-semibold text-ink">
              Email us
            </h2>
            <p className="text-base leading-relaxed text-ink sm:text-lg">
              <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="font-semibold">
                {SUPPORT_CONTACT_EMAIL}
              </a>
              <br />
              <span className="text-sub">
                We aim to reply within a couple of business days.
              </span>
            </p>
          </section>

          <SectionHeader>Common questions</SectionHeader>

          <SubHeader>What do the trust levels mean?</SubHeader>
          <p>
            Every place shows how its halal status was confirmed:{" "}
            <strong>Trust Halal Verified</strong> (confirmed in person by a
            community verifier), <strong>Certificate on file</strong> (a valid
            halal certificate we&apos;ve reviewed), or{" "}
            <strong>Owner-attested</strong> (the restaurant told us their halal
            posture, shown exactly as they stated it). Open any place to see the
            full breakdown — menu posture, per-meat sourcing, alcohol, and more.
          </p>

          <SubHeader>I forgot my password.</SubHeader>
          <p>
            On the sign-in screen, tap <strong>Forgot password?</strong>, enter
            your email, and we&apos;ll send a reset link. It expires after an
            hour; open it, choose a new password, and sign back in.
          </p>

          <SubHeader>A listing looks wrong. How do I report it?</SubHeader>
          <p>
            Halal information changing is exactly what we want to catch. You can
            report an inaccurate listing from its page on{" "}
            <a href={CONSUMER_URL}>halalfoodnearme.com</a>, and Trust Halal staff
            review every report. If the report is upheld, the listing is flagged
            for correction.
          </p>

          <SubHeader>How do I become a verifier?</SubHeader>
          <p>
            Verifiers are community members who confirm halal spots in person —
            it&apos;s how places earn the highest tier of trust. Apply through
            the <a href={VERIFIER_URL}>verifier program</a>. We&apos;ll review
            your application and let you know by email.
          </p>

          <SubHeader>I own a restaurant. How do I claim it?</SubHeader>
          <p>
            Head to the <a href={OWNER_GET_VERIFIED_URL}>owner portal</a> to claim your place,
            add your halal details, and upload a certificate if you have one.
            Verification is free for restaurants.
          </p>

          <SubHeader>How do I delete my account or data?</SubHeader>
          <p>
            Profile → Delete account in the app, or email us at{" "}
            <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`}>
              {SUPPORT_CONTACT_EMAIL}
            </a>{" "}
            from the address on your account if you&apos;ve already
            uninstalled it. Our{" "}
            <a href={DELETE_ACCOUNT_PATH}>account deletion page</a> lists the
            steps and exactly what is deleted and what is kept — see also the{" "}
            <a href={PRIVACY_PATH}>privacy policy</a>.
          </p>

          <SubHeader>Why don&apos;t I see many places near me?</SubHeader>
          <p>
            We&apos;re growing our coverage city by city, and every place is
            checked before it appears — so some areas are thin while we build
            them out. Saving places you&apos;d like verified and becoming a
            verifier both help us get to your area faster.
          </p>

          <SectionHeader>Still need a hand?</SectionHeader>
          <p>
            Email{" "}
            <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`}>
              {SUPPORT_CONTACT_EMAIL}
            </a>{" "}
            with as much detail as you can — the place, your device, and what you
            expected to happen. We read every message.
          </p>

          <hr className="my-10 border-line" />
          <p className="text-sm italic text-sub">
            The permanent home of this page is{" "}
            <span className="font-mono not-italic text-ink">
              trusthalal.org/support
            </span>
            .
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}

// ---------------------------------------------------------------------------
// Document typography helpers (match /ethics + /privacy)
// ---------------------------------------------------------------------------
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 mt-12 tracking-tight text-2xl font-semibold text-ink sm:text-3xl">
      {children}
    </h2>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-8 tracking-tight text-xl font-semibold text-ink">
      {children}
    </h3>
  );
}
