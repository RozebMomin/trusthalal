/**
 * /privacy — Trust Halal privacy policy.
 *
 * Required by the App Store and Play Store (privacy policy URL) and by the
 * consumer web + owner portal. Server-rendered, zero client JS, styled with
 * the same v2 brand system + document typography as /ethics.
 *
 * NOTE: This is an honest, plain-language draft written to the product's
 * actual data practices. Have counsel review before relying on it for a
 * jurisdiction with specific requirements (GDPR/CCPA specifics, etc.).
 * Keep the "Last updated" date current whenever the wording changes.
 */

import type { Metadata } from "next";

import { Footer, Header } from "@/components/chrome";
import {
  CONSUMER_URL,
  PRIVACY_CONTACT_EMAIL,
  SUPPORT_PATH,
} from "@/lib/links";

const LAST_UPDATED = "July 2026";

const PAGE_TITLE = "Privacy Policy";
const PAGE_DESCRIPTION =
  "What Trust Halal collects, why, who we share it with, and the control you have over your data. Plain language, no surprises.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: {
    type: "article",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/privacy",
  },
  twitter: { card: "summary", title: PAGE_TITLE, description: PAGE_DESCRIPTION },
};

export default function PrivacyPage() {
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
            <span>Privacy</span>
          </nav>

          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Privacy Policy
          </p>
          <h1 className="mb-6 tracking-tight text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            Your data, and what we do with it.
          </h1>
          <p className="mb-2 text-lg leading-relaxed text-sub sm:text-xl">
            We collect the minimum we need to help you find halal food you can
            trust — and we never sell it or use it to track you across other
            apps.
          </p>
          <p className="mb-8 text-sm text-sub">Last updated: {LAST_UPDATED}</p>

          <p>
            This policy covers the Trust Halal mobile app, our website{" "}
            <a href={CONSUMER_URL}>halalfoodnearme.com</a>, and the owner and
            admin portals (together, the &ldquo;Service&rdquo;), operated by
            Trust Halal. By using the Service, you agree to this policy.
          </p>

          <SectionHeader>What we collect</SectionHeader>

          <SubHeader>Information you give us</SubHeader>
          <ul>
            <li>
              <strong>Account details</strong> — your email address and display
              name when you create an account. Passwords are stored only as a
              salted hash; we never see or store your actual password.
            </li>
            <li>
              <strong>Content you submit</strong> — places you save as
              favorites, reports (&ldquo;disputes&rdquo;) you file about a
              listing, photos you upload, and, if you&apos;re a verifier, the
              details and photos of in-person visits you file.
            </li>
            <li>
              <strong>Messages</strong> — anything you email us or send through
              a support or feedback form.
            </li>
          </ul>

          <SubHeader>Information we collect automatically</SubHeader>
          <ul>
            <li>
              <strong>Location</strong> — with your permission, your device
              location so we can show halal places near you. You can use the
              app without granting location and search by city instead, and you
              can turn the permission off any time in your device settings.
            </li>
            <li>
              <strong>Usage &amp; device data</strong> — basic analytics about
              how the Service is used (screens viewed, searches run, features
              used), plus device type, operating system, and app version. We
              use this to understand what&apos;s working and fix what isn&apos;t.
            </li>
            <li>
              <strong>Crash &amp; performance data</strong> — diagnostic
              information when something breaks, so we can make the app more
              stable.
            </li>
            <li>
              <strong>Sign-in sessions</strong> — on the web, a secure,
              HttpOnly session cookie that keeps you logged in. It&apos;s
              essential to the Service, not advertising.
            </li>
          </ul>

          <SectionHeader>How we use it</SectionHeader>
          <ul>
            <li>Run the Service — search, trust profiles, favorites, accounts.</li>
            <li>
              Operate the trust system — review claims, verify places, and
              handle the reports you file.
            </li>
            <li>
              Send you email you&apos;d expect — account and security messages,
              and updates about things you act on (a claim decision, a report
              outcome). Optional, non-essential emails (like &ldquo;a place you
              saved is now verified&rdquo;) always include a one-click
              unsubscribe.
            </li>
            <li>Keep the Service secure and prevent abuse.</li>
            <li>Understand and improve how the app is used.</li>
          </ul>

          <SectionHeader>Who we share it with</SectionHeader>
          <p>
            We do <strong>not</strong> sell your personal information, and we do
            not use it for cross-app advertising or tracking. We share data only
            with the service providers that help us run Trust Halal, and only as
            needed:
          </p>
          <ul>
            <li>
              <strong>Hosting &amp; database</strong> (Supabase) — stores your
              account, content, and uploaded files.
            </li>
            <li>
              <strong>Maps &amp; places</strong> (Google Maps Platform) — powers
              search, maps, and place details.
            </li>
            <li>
              <strong>Email delivery</strong> (Resend) — sends the transactional
              emails above.
            </li>
            <li>
              <strong>Analytics</strong> (PostHog) — product usage analytics.
            </li>
            <li>
              <strong>Error monitoring</strong> (Sentry) — crash and performance
              diagnostics.
            </li>
            <li>
              <strong>App distribution</strong> (Apple, Google) — when you
              install or update the app.
            </li>
          </ul>
          <p>
            We may also disclose information if required by law, or to protect
            the rights, safety, and integrity of the Service and its users.
          </p>

          <SectionHeader>How long we keep it</SectionHeader>
          <p>
            We keep your information for as long as your account is active or as
            needed to provide the Service. Some records (like a resolved report
            or an audit of a trust decision) are retained to keep the platform
            accountable. When you delete your account, we delete or de-identify
            your personal data, except where we&apos;re required to keep it by
            law.
          </p>

          <SectionHeader>Your choices and rights</SectionHeader>
          <ul>
            <li>
              <strong>Access &amp; correction</strong> — view and update your
              profile in the app, or ask us for a copy of your data.
            </li>
            <li>
              <strong>Delete your account</strong> — request deletion any time
              (see Contact below); we&apos;ll remove your personal data.
            </li>
            <li>
              <strong>Location</strong> — grant or revoke it in your device
              settings; the app still works without it.
            </li>
            <li>
              <strong>Email</strong> — unsubscribe from non-essential emails via
              the link in any of them.
            </li>
          </ul>
          <p>
            Depending on where you live, you may have additional rights (for
            example under GDPR or CCPA). Contact us and we&apos;ll honor them.
          </p>

          <SectionHeader>Children</SectionHeader>
          <p>
            Trust Halal is not directed to children under 13, and we don&apos;t
            knowingly collect personal information from them. If you believe a
            child has given us data, contact us and we&apos;ll delete it.
          </p>

          <SectionHeader>Security &amp; storage</SectionHeader>
          <p>
            We protect your data with industry-standard measures — encryption in
            transit, hashed passwords, scoped access, and short-lived signed
            links for private files. No system is perfectly secure, but we work
            to keep yours safe. Our services are operated in the United States;
            if you use the Service from elsewhere, your data is processed there.
          </p>

          <SectionHeader>Changes to this policy</SectionHeader>
          <p>
            We may update this policy as the Service evolves. When we make
            material changes, we&apos;ll update the &ldquo;Last updated&rdquo;
            date above and, where appropriate, notify you in-product or by
            email. Continuing to use the Service after a change means you accept
            the updated policy.
          </p>

          <SectionHeader>Contact us</SectionHeader>
          <p>
            Questions, requests, or concerns about your data? Email{" "}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>
              {PRIVACY_CONTACT_EMAIL}
            </a>
            . For general help, see our{" "}
            <a href={SUPPORT_PATH}>support page</a>.
          </p>

          <hr className="my-10 border-line" />
          <p className="text-sm italic text-sub">
            The permanent home of this policy is{" "}
            <span className="font-mono not-italic text-ink">
              trusthalal.org/privacy
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
// Document typography helpers (match /ethics)
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
