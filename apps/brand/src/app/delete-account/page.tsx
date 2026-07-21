/**
 * /delete-account — the public account deletion instructions.
 *
 * Google Play requires a URL on the store listing that a user can reach to
 * request deletion, and it has to do three specific things: name the app or
 * developer as shown on the listing, prominently feature the steps to
 * request deletion, and state what is deleted, what is kept, and for how
 * long. A FAQ entry buried in /support doesn't clear the "prominently
 * feature" bar, which is why this is its own page.
 *
 * The audience is specifically someone who no longer has the app installed —
 * that's the whole reason a web page is required when in-app deletion already
 * exists. So the email route is given equal weight to the in-app one rather
 * than being a footnote.
 *
 * The "what is kept" list is not marketing-friendly and is stated anyway.
 * Someone deleting their account is entitled to know that their reports
 * survive anonymised and their owner replies stay up, and finding that out
 * afterwards is exactly how a deletion promise loses its credibility. It
 * mirrors what the app's own delete screen says, and both mirror
 * api/app/modules/users/deletion.py — if that changes, all three change.
 */

import type { Metadata } from "next";

import { Footer, Header } from "@/components/chrome";
import {
  CONSUMER_URL,
  PRIVACY_PATH,
  SUPPORT_CONTACT_EMAIL,
} from "@/lib/links";

const PAGE_TITLE = "Delete your Trust Halal account";
const PAGE_DESCRIPTION =
  "How to delete your Trust Halal account and what happens to your data — from inside the app, or by email if you've already uninstalled it.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/delete-account" },
  openGraph: {
    type: "article",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/delete-account",
  },
  twitter: { card: "summary", title: PAGE_TITLE, description: PAGE_DESCRIPTION },
};

export default function DeleteAccountPage() {
  return (
    <>
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 pt-8 sm:pt-10">
        <Header />
        <article className="prose-brand mx-auto mb-24 w-full max-w-2xl">
          <nav aria-label="Breadcrumb" className="mb-6 text-sm text-sub">
            <a href="/" className="hover:text-ink">
              Trust Halal
            </a>
            <span className="px-2">·</span>
            <span className="text-ink">Delete account</span>
          </nav>

          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent-deep">
            Your account
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Delete your Trust Halal account
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-sub">
            You can delete your Trust Halal account, published by Trust Halal
            LLC, at any time. Here&rsquo;s how, and exactly what happens to
            your data when you do.
          </p>

          <SectionHeader>How to delete your account</SectionHeader>

          <SubHeader>In the app</SubHeader>
          <ol>
            <li>Open Trust Halal and go to the Profile tab.</li>
            <li>
              Tap <strong>Delete account</strong>, near the bottom under
              Account.
            </li>
            <li>
              Enter your password and type <strong>DELETE</strong> to confirm.
            </li>
            <li>
              Tap <strong>Delete my account</strong>. It happens immediately
              and can&rsquo;t be undone.
            </li>
          </ol>
          <p className="mt-4">
            The same option is on{" "}
            <a href={CONSUMER_URL} className="underline underline-offset-2">
              halalfoodnearme.com
            </a>{" "}
            if you&rsquo;d rather do it in a browser.
          </p>

          {/* The route that matters for this page's actual purpose: someone
              who has already uninstalled and has no in-app option left. */}
          <SubHeader>By email, if you&rsquo;ve uninstalled the app</SubHeader>
          <p>
            Email{" "}
            <a
              href={`mailto:${SUPPORT_CONTACT_EMAIL}?subject=Delete%20my%20account`}
              className="underline underline-offset-2"
            >
              {SUPPORT_CONTACT_EMAIL}
            </a>{" "}
            from the address on your account and ask us to delete it. We
            don&rsquo;t need a reason. We&rsquo;ll confirm it&rsquo;s you,
            delete the account, and reply to confirm when it&rsquo;s done —
            normally within a few days.
          </p>

          <SectionHeader>What gets deleted</SectionHeader>
          <ul>
            <li>Your account and sign-in.</li>
            <li>Every review you&rsquo;ve written, and the photos on them.</li>
            <li>Photos you added to restaurants as a diner.</li>
            <li>
              Your saved places, search preferences, and notification settings.
            </li>
            <li>
              Your device registrations, so the app stops sending you
              notifications.
            </li>
          </ul>
          <p className="mt-4">
            The image files behind your photos are queued for removal from
            storage as part of the same process, not just unlinked.
          </p>

          <SectionHeader>What stays, and why</SectionHeader>
          <p>
            We&rsquo;d rather tell you this now than have you discover it
            afterwards.
          </p>
          <ul>
            <li>
              <strong>Reports you filed</strong> stay on file so we can finish
              reviewing them, but they stop being linked to you.
            </li>
            <li>
              <strong>Replies you posted on behalf of a restaurant</strong>
              {" "}stay published. They speak for the business rather than for
              you personally, and removing them would silence the restaurant
              rather than you.
            </li>
            <li>
              <strong>Restaurants and halal profiles you created or claimed</strong>
              {" "}remain. A restaurant&rsquo;s halal information is a public
              record other diners rely on; it doesn&rsquo;t belong to one
              person&rsquo;s login.
            </li>
          </ul>

          <SectionHeader>Retention</SectionHeader>
          <p>
            Deletion takes effect immediately. Copies may persist in encrypted
            backups for up to 30 days before those rotate out, and we may keep
            records for longer where the law requires it, or where they are
            reasonably necessary to prevent fraud, resolve a dispute, or
            enforce our terms. Anything kept for those reasons is not used to
            build a profile of you or shown to anyone else.
          </p>
          <p className="mt-4">
            Full detail is in our{" "}
            <a href={PRIVACY_PATH} className="underline underline-offset-2">
              privacy policy
            </a>
            .
          </p>

          <hr className="my-10 border-line" />
          <p className="text-sm italic text-sub">
            Questions before you decide?{" "}
            <a
              href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
              className="not-italic underline underline-offset-2"
            >
              {SUPPORT_CONTACT_EMAIL}
            </a>
            .
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}

// ---------------------------------------------------------------------------
// Document typography helpers (match /ethics + /privacy + /terms)
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 mt-12 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
      {children}
    </h2>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-8 text-xl font-semibold tracking-tight text-ink">
      {children}
    </h3>
  );
}
