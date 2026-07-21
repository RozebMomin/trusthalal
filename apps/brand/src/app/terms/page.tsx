/**
 * /terms — Trust Halal terms of service.
 *
 * Required by App Store Review Guideline 1.2: an app hosting user-generated
 * content has to make users agree to terms that state plainly there is no
 * tolerance for objectionable content or abusive users. The other four 1.2
 * requirements are already built — moderation on submit, review reporting,
 * user blocking, published contact — and this was the gap.
 *
 * It also does the quieter job of establishing that we may publish what
 * someone submits. Diners upload photos and write reviews; without a licence
 * granted here, nothing gives us the right to show them.
 *
 * NOTE: This is an honest, plain-language draft written to what the product
 * actually does. It has NOT been reviewed by a lawyer. Have counsel read it
 * before relying on it — particularly the liability, indemnity and governing
 * law sections, which are the parts a template gets wrong. Keep the
 * "Last updated" date current whenever the wording changes.
 */

import type { Metadata } from "next";

import { Footer, Header } from "@/components/chrome";
import {
  CONSUMER_URL,
  CONTACT_EMAIL,
  PRIVACY_PATH,
  SUPPORT_CONTACT_EMAIL,
  SUPPORT_PATH,
} from "@/lib/links";

const LAST_UPDATED = "July 2026";

const PAGE_TITLE = "Terms of Service";
const PAGE_DESCRIPTION =
  "The rules for using Trust Halal: what you can post, what we do about content that breaks the rules, and what we can and can't promise about a listing.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: {
    type: "article",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/terms",
  },
  twitter: { card: "summary", title: PAGE_TITLE, description: PAGE_DESCRIPTION },
};

export default function TermsPage() {
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
            <span className="text-ink">Terms</span>
          </nav>

          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent-deep">
            Terms
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            The rules, in plain language.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-sub">
            Trust Halal only works if what&rsquo;s written here can be trusted.
            These terms exist to keep it that way — and to be honest about the
            limits of what we can promise.
          </p>
          <p className="mt-4 text-sm text-sub">Last updated: {LAST_UPDATED}</p>

          <p className="mt-8">
            These terms cover Trust Halal — the mobile apps, {" "}
            <a href={CONSUMER_URL} className="underline underline-offset-2">
              halalfoodnearme.com
            </a>
            , the owner portal, and anything else we run under the Trust Halal
            name. They&rsquo;re an agreement between you and Trust Halal LLC.
            By creating an account or using the service, you accept them. If
            you don&rsquo;t, please don&rsquo;t use Trust Halal.
          </p>

          {/* The Guideline 1.2 clause. Deliberately first and deliberately
              blunt — this is the section a reviewer looks for, and burying
              it under boilerplate would defeat the point of having it. */}
          <SectionHeader>No tolerance for objectionable content</SectionHeader>
          <p>
            There is <strong>no tolerance</strong> for objectionable content or
            abusive users on Trust Halal. Post something that breaks the rules
            below and we will remove it and may terminate your account without
            warning.
          </p>
          <p className="mt-4">Specifically, you agree not to submit:</p>
          <ul>
            <li>
              Harassment, threats, or abuse directed at any person — a diner, a
              restaurant owner, a member of staff, or one of our verifiers.
            </li>
            <li>
              Slurs or content attacking people over religion, race, ethnicity,
              nationality, gender, sexuality, disability, or immigration status.
            </li>
            <li>Sexual content, or anything sexualising a minor.</li>
            <li>
              Claims about a restaurant you know to be false — including
              accusations about halal status invented to damage a business, and
              reviews written by or for a competitor.
            </li>
            <li>
              Reviews you were paid for, or that you wrote about your own
              restaurant or one you work for, without saying so.
            </li>
            <li>
              Photos that aren&rsquo;t yours, or documents you don&rsquo;t have
              the right to share.
            </li>
            <li>
              Other people&rsquo;s private information — addresses, phone
              numbers, anything of that kind.
            </li>
            <li>Spam, advertising, malware, or scraping of the service.</li>
          </ul>

          <SubHeader>How we enforce this</SubHeader>
          <p>
            Every review runs through an automated content check before it
            posts. Anyone can report a review from inside the app, and anyone
            can block another user so that person&rsquo;s content disappears
            from their view.
          </p>
          <p className="mt-4">
            <strong>
              We aim to review every report within 24 hours,
            </strong>{" "}
            removing content that breaks these rules and removing the accounts
            of people who keep breaking them. If your account is terminated you
            may write to us at{" "}
            <a
              href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {SUPPORT_CONTACT_EMAIL}
            </a>{" "}
            and a person will look at it again.
          </p>

          <SectionHeader>Your account</SectionHeader>
          <p>
            You need to be 13 or older to have an account. Give us accurate
            information, keep your password to yourself, and tell us if you
            think someone else is using your account. What happens under your
            account is your responsibility.
          </p>
          <p className="mt-4">
            You can delete your account at any time from the app or the
            website. What that removes and what it leaves behind is set out in{" "}
            <a href={PRIVACY_PATH} className="underline underline-offset-2">
              the privacy policy
            </a>
            .
          </p>

          <SectionHeader>What you post stays yours</SectionHeader>
          <p>
            Your reviews and photos belong to you. We don&rsquo;t claim
            ownership of them.
          </p>
          <p className="mt-4">
            To show them to other people, we need your permission, so by
            submitting content you give Trust Halal a worldwide, non-exclusive,
            royalty-free licence to host, store, display, reproduce and
            distribute it in connection with running and promoting the service.
            You keep the right to delete your content, and when you do we stop
            displaying it.
          </p>
          <p className="mt-4">
            Two honest caveats. Copies may persist in backups for a while
            after deletion. And a review that has been quoted or aggregated —
            in a rating average, say — may leave a trace that isn&rsquo;t
            individually identifiable.
          </p>
          <p className="mt-4">
            You promise that what you submit is yours to submit and that
            publishing it doesn&rsquo;t break anyone else&rsquo;s rights.
          </p>

          <SectionHeader>What we can and can&rsquo;t promise</SectionHeader>
          <p>
            This is the section that matters most, so we&rsquo;d rather
            over-explain it than hide it.
          </p>
          <p className="mt-4">
            Trust Halal shows you what a restaurant claims about its kitchen
            and how much evidence sits behind that claim. Those are different
            things and we label them differently. An owner-attested listing is
            the restaurant&rsquo;s own description and nobody has checked it. A
            certificate on file means we hold a document. A verified listing
            means one of our verifiers visited.
          </p>
          <p className="mt-4">
            <strong>
              None of these is a religious ruling, and none is a guarantee that
              any particular meal is halal.
            </strong>{" "}
            Kitchens change suppliers. Staff change. Certificates lapse. A
            visit describes one day. If the answer matters to you — and it
            does, or you wouldn&rsquo;t be here — treat what we show you as
            evidence to act on rather than a verdict to rely on, and ask the
            restaurant yourself.
          </p>
          <p className="mt-4">
            Reviews are the opinions of the people who wrote them, not ours. We
            don&rsquo;t endorse any restaurant, certifier, or reviewer, and we
            don&rsquo;t accept payment to change a listing&rsquo;s verification
            level or to remove a review a restaurant dislikes.
          </p>
          <p className="mt-4">
            The service is provided &ldquo;as is&rdquo;, without warranties of
            any kind, to the fullest extent the law allows. To the extent the
            law allows, Trust Halal LLC is not liable for indirect or
            consequential losses arising from your use of it, and our total
            liability is limited to the greater of the amount you&rsquo;ve paid
            us in the past twelve months or one hundred US dollars. Some places
            don&rsquo;t allow these limits, in which case they don&rsquo;t
            apply to you.
          </p>

          <SectionHeader>If you own a restaurant</SectionHeader>
          <p>
            Claiming a restaurant means telling us you&rsquo;re authorised to
            speak for that business. Don&rsquo;t claim one you aren&rsquo;t.
          </p>
          <p className="mt-4">
            What you tell us about your kitchen — sourcing, slaughter method,
            certificates, alcohol and pork policy — has to be accurate, and you
            need to update it when it changes, because diners are making
            decisions on it. Submitting a certificate you don&rsquo;t hold, or
            that has expired, is grounds for removing your listing&rsquo;s
            verification and your access.
          </p>
          <p className="mt-4">
            You can reply publicly to any review of your restaurant and report
            one that breaks these rules. You cannot have a review removed for
            being unflattering, and asking will not work.
          </p>

          <SectionHeader>Our stuff</SectionHeader>
          <p>
            The Trust Halal name, logo, software, and the way we organise and
            present this information belong to Trust Halal LLC. Restaurant
            information from third-party sources — including business details
            and ratings shown as coming from Google — belongs to those
            providers and is shown under their terms.
          </p>
          <p className="mt-4">
            Don&rsquo;t copy the service, scrape it, resell it, or reverse
            engineer it.
          </p>

          <SectionHeader>Ending things</SectionHeader>
          <p>
            You can stop using Trust Halal and delete your account whenever you
            like. We can suspend or terminate an account that breaks these
            terms, and we&rsquo;ll tell you why unless there&rsquo;s a legal
            reason not to. The sections on content licences, disclaimers and
            liability survive the end of your account.
          </p>

          <SectionHeader>Changes</SectionHeader>
          <p>
            We&rsquo;ll update these terms as the product changes. When the
            change is material we&rsquo;ll say so in the app or by email rather
            than quietly editing this page, and the date at the top always
            reflects the current version. Carrying on using Trust Halal after a
            change means you accept it.
          </p>

          <SectionHeader>Governing law</SectionHeader>
          <p>
            These terms are governed by the laws of the State of Georgia, USA,
            without regard to its conflict-of-laws rules. Disputes go to the
            state or federal courts located in Georgia.
          </p>

          <SectionHeader>Contact us</SectionHeader>
          <p>
            Questions about these terms, or about a decision we&rsquo;ve made:{" "}
            <a
              href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {SUPPORT_CONTACT_EMAIL}
            </a>
            . Anything else:{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {CONTACT_EMAIL}
            </a>
            . There&rsquo;s more in our{" "}
            <a href={SUPPORT_PATH} className="underline underline-offset-2">
              support pages
            </a>
            .
          </p>

          <hr className="my-10 border-line" />
          <p className="text-sm italic text-sub">
            The permanent home of these terms is{" "}
            <span className="font-mono not-italic text-ink">
              trusthalal.org/terms
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
