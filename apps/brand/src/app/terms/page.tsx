/**
 * /terms — Trust Halal terms of service. V2.
 *
 * Required by App Store Review Guideline 1.2: an app hosting user-generated
 * content has to make users agree to terms that state plainly there is no
 * tolerance for objectionable content or abusive users. The other four 1.2
 * requirements are already built — moderation on submit, review reporting,
 * user blocking, published contact.
 *
 * ## The one place counsel's review and Apple's rule disagree
 *
 * The V2 review recommended replacing "there is no tolerance" with
 * discretionary wording, on the sound general principle that absolute
 * promises are enforceable against you. But Guideline 1.2 requires those
 * terms to "make it clear that there is no tolerance for objectionable
 * content or abusive users" — near-verbatim. Dropping the phrase to reduce
 * legal exposure would trade a small contract risk for a likely App Store
 * rejection of the whole app.
 *
 * So this document does both, and the order is deliberate: the absolute
 * statement of posture, immediately followed by reserved discretion over how
 * and when we act on it. Apple gets the sentence it requires; the reservation
 * of discretion is what keeps it from reading as a guaranteed service level.
 * If a lawyer wants to change this, that context needs to travel with the
 * request.
 *
 * Same tension, smaller, on the 24-hour line. Apple expects reports acted on
 * within 24 hours, so the number stays; the volume caveat is what stops it
 * being an unconditional guarantee.
 *
 * ## Not incorporated, on purpose
 *
 * Binding arbitration and a class-action waiver (#23) — the review flagged
 * these as a strategic business decision rather than a legal requirement, and
 * they materially reduce users' rights. That is the owner's call to make
 * knowingly, not something to inherit from a draft.
 *
 * Export/sanctions (#25) — deferred until there's international distribution.
 *
 * NOTE: reviewed once against the V2 recommendations, still not by a lawyer
 * end to end. Keep LAST_UPDATED and app/core/legal.py TERMS_VERSION in sync —
 * bumping the latter re-prompts every existing user to accept.
 */

import type { Metadata } from "next";

import { Footer, Header } from "@/components/chrome";
import {
  CONSUMER_URL,
  CONTACT_EMAIL,
  LEGAL_CONTACT_EMAIL,
  PRIVACY_PATH,
  SUPPORT_CONTACT_EMAIL,
  SUPPORT_PATH,
} from "@/lib/links";

/** Must match TERMS_VERSION in api/app/core/legal.py. */
const LAST_UPDATED = "2026-07-21";

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

          <SectionHeader>Who these terms are between</SectionHeader>
          <p>
            Throughout these Terms, &ldquo;Trust Halal&rdquo;,
            &ldquo;we&rdquo;, &ldquo;our&rdquo; and &ldquo;us&rdquo; mean Trust
            Halal LLC. &ldquo;Service&rdquo; means our mobile applications,
            websites (including{" "}
            <a href={CONSUMER_URL} className="underline underline-offset-2">
              halalfoodnearme.com
            </a>
            ), APIs, owner portal, verification tools, and any other product
            operated under the Trust Halal name. &ldquo;You&rdquo; means
            whoever is using it.
          </p>
          <p className="mt-4">
            By creating an account or using the Service, you accept these
            Terms. If you don&rsquo;t, please don&rsquo;t use Trust Halal. Your
            use is also governed by our{" "}
            <a href={PRIVACY_PATH} className="underline underline-offset-2">
              Privacy Policy
            </a>
            , which explains what we collect and why.
          </p>

          {/* Guideline 1.2's required sentence, first and blunt, followed
              immediately by reserved discretion. See the file header for why
              both have to be here. */}
          <SectionHeader>No tolerance for objectionable content</SectionHeader>
          <p>
            There is <strong>no tolerance</strong> for objectionable content or
            abusive users on Trust Halal.
          </p>
          <p className="mt-4">
            We reserve the right to remove objectionable content immediately,
            and to suspend or terminate any account that violates these Terms,
            at our discretion and without prior notice.
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
            <li>Spam, advertising, malware, or scraping of the Service.</li>
          </ul>

          <SubHeader>How we enforce this</SubHeader>
          <p>
            Every review runs through an automated content check before it
            posts. Anyone can report a review from inside the app, and anyone
            can block another user.
          </p>
          <p className="mt-4">
            We aim to review reports promptly — typically within 24 hours —
            removing content that breaks these rules and removing the accounts
            of people who keep breaking them. Response times may vary with the
            volume and complexity of reports. If your account is terminated you
            may write to{" "}
            <a
              href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {SUPPORT_CONTACT_EMAIL}
            </a>{" "}
            and a person will look at it again.
          </p>
          <p className="mt-4">
            Blocking someone only affects your own experience. It hides them
            from you; it doesn&rsquo;t remove their content from Trust Halal or
            tell them they&rsquo;ve been blocked. If something should come down
            for everyone, report it.
          </p>
          <p className="mt-4">
            Reviews are the opinions of the people who wrote them.{" "}
            <strong>
              Trust Halal is not responsible for user-generated content
            </strong>{" "}
            and does not endorse it.
          </p>

          <SectionHeader>Your account</SectionHeader>
          <p>
            You must be at least 13 years old, or the minimum age required to
            consent to digital services in your jurisdiction, whichever is
            higher.
          </p>
          <p className="mt-4">
            Give us accurate information and keep your login credentials
            confidential. You&rsquo;re responsible for activity that happens
            under your account, except where it results from our own negligence
            or a security failure on our side. Tell us promptly if you think
            someone else has access.
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
            To show them to other people, we need your permission. By
            submitting content you give Trust Halal a worldwide, non-exclusive,
            royalty-free, transferable and sublicensable licence to host,
            store, display, reproduce, adapt for formatting, and distribute it
            in connection with operating and promoting the Service. The
            sublicence matters for one practical reason: the content has to
            pass through the companies that run our infrastructure — hosting,
            content delivery, email, analytics, and similar vendors acting on
            our behalf — and none of that works without permission to hand it
            to them for that purpose.
          </p>
          <p className="mt-4">
            You keep the right to delete your content, and when you do we stop
            displaying it. Copies may persist in backups for a period
            afterwards, and we may retain copies where reasonably necessary to
            comply with law, prevent fraud, resolve disputes, or enforce these
            Terms. Content that has been aggregated — counted into a rating
            average, say — may leave a trace that isn&rsquo;t individually
            identifiable.
          </p>
          <p className="mt-4">
            You represent that what you submit is yours to submit and that
            publishing it doesn&rsquo;t infringe anyone else&rsquo;s rights.
          </p>

          <SectionHeader>Copyright complaints</SectionHeader>
          <p>
            If you believe something on Trust Halal infringes your copyright,
            send a notice to{" "}
            <a
              href={`mailto:${LEGAL_CONTACT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {LEGAL_CONTACT_EMAIL}
            </a>{" "}
            including: your contact details; identification of the work; the
            URL or location of the material; a statement that you have a good
            faith belief the use isn&rsquo;t authorised; a statement, under
            penalty of perjury, that your notice is accurate and you are the
            owner or authorised to act for them; and your signature, physical
            or electronic.
          </p>
          <p className="mt-4">
            We remove material that is the subject of a valid notice and tell
            whoever posted it. If you believe your content was removed in
            error, you may send a counter-notice to the same address. We
            terminate the accounts of repeat infringers.
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
              Nothing on Trust Halal is a religious ruling (fatwa), legal
              advice, or a certification that any meal satisfies your personal
              religious obligations.
            </strong>
          </p>
          <p className="mt-4">
            Verification reflects the information reasonably available at the
            time of the visit or review. It is not an ongoing guarantee.
            Restaurant practices can change at any time and without notice —
            suppliers change, staff change, certificates lapse, and a visit
            describes one day. You remain responsible for making dining
            decisions according to your own religious standards, including by
            confirming details directly with the restaurant where that matters
            to you.
          </p>
          <p className="mt-4">
            We don&rsquo;t endorse any restaurant, certifier, or reviewer, and
            we don&rsquo;t accept payment to raise a listing&rsquo;s
            verification level or to remove a legitimate review.
          </p>
          <p className="mt-4">
            To the fullest extent permitted by law, the Service is provided
            &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, and we disclaim
            all warranties, express or implied, including any implied
            warranties of merchantability, fitness for a particular purpose,
            title, and non-infringement.
          </p>
          <p className="mt-4">
            To the fullest extent permitted by law, Trust Halal LLC is not
            liable for any indirect, incidental, special, consequential, or
            punitive damages, or for lost profits, lost business opportunities,
            lost data, business interruption, or reputational harm, arising
            from or relating to your use of the Service. Our total liability
            for any claim is limited to the greater of the amount you have paid
            us in the twelve months before the claim or one hundred US dollars.
            Some jurisdictions don&rsquo;t allow these limits, in which case
            they don&rsquo;t apply to you.
          </p>

          <SectionHeader>If you own a restaurant</SectionHeader>
          <p>By claiming a restaurant, you represent that you:</p>
          <ul>
            <li>
              Are authorised to act on behalf of that business and to make the
              statements you submit;
            </li>
            <li>
              Are giving us truthful, accurate and complete information about
              the kitchen — sourcing, slaughter method, certificates, alcohol
              and pork policy;
            </li>
            <li>
              Will keep that information current as things change, because
              diners are making decisions on it.
            </li>
          </ul>
          <p className="mt-4">
            We may ask you to provide proof of ownership or authority at any
            time, and may suspend a claim or listing while we do.
          </p>
          <p className="mt-4">
            Submitting a certificate you don&rsquo;t hold, that has expired, or
            that has been altered is fraud against every diner reading the
            listing. It may result in immediate suspension, removal of
            verification status, termination of your account, and referral to
            the certifying body or to the relevant authorities where
            appropriate.
          </p>
          <p className="mt-4">
            You can reply publicly to any review of your restaurant and report
            one that breaks these rules. You cannot have a review removed for
            being unflattering, and asking will not work.
          </p>

          <SectionHeader>Our stuff</SectionHeader>
          <p>
            The Trust Halal name, logo, software, and the selection and
            arrangement of the information we present belong to Trust Halal
            LLC. Restaurant information from third-party sources — including
            business details and ratings shown as coming from Google — belongs
            to those providers and is shown under their terms.
          </p>
          <p className="mt-4">
            Except where expressly permitted by applicable law or by us in
            writing, you may not copy, resell, reverse engineer, or create
            derivative works from the Service. Automated access — bots,
            crawlers, scrapers, or use of our APIs other than as we&rsquo;ve
            authorised — is prohibited unless we&rsquo;ve agreed to it in
            writing.
          </p>

          <SectionHeader>Indemnity</SectionHeader>
          <p>
            You agree to indemnify and hold harmless Trust Halal LLC and its
            officers, employees and contractors from any claim, loss, liability
            or expense (including reasonable legal fees) arising from content
            you submit, your use or misuse of the Service, or your breach of
            these Terms or of anyone else&rsquo;s rights.
          </p>

          <SectionHeader>Ending things</SectionHeader>
          <p>
            You can stop using Trust Halal and delete your account whenever you
            like.
          </p>
          <p className="mt-4">
            We may suspend or terminate an account that breaks these Terms, and
            we&rsquo;ll tell you why unless there&rsquo;s a legal reason not
            to. We also reserve the right to investigate suspected misconduct,
            preserve relevant records as evidence, and cooperate with law
            enforcement where we&rsquo;re legally required to or where there is
            a credible risk to someone&rsquo;s safety. The sections on content
            licences, disclaimers, limitation of liability and indemnity
            survive the end of your account.
          </p>

          <SectionHeader>Things outside our control</SectionHeader>
          <p>
            We aren&rsquo;t liable for failures or delays caused by events
            beyond our reasonable control — cloud or hosting provider outages,
            internet and network failures, power failures, natural disasters,
            epidemics, labour disputes, war, terrorism, or government action.
          </p>

          <SectionHeader>Changes</SectionHeader>
          <p>
            We&rsquo;ll update these Terms as the product changes. When a
            change is material we&rsquo;ll say so in the app or by email rather
            than quietly editing this page, and we&rsquo;ll ask you to accept
            the new version. Material changes take effect on the date stated at
            the top of this page, and continuing to use Trust Halal after that
            date means you accept them.
          </p>

          <SectionHeader>Governing law</SectionHeader>
          <p>
            These Terms are governed by the laws of the State of Georgia, USA,
            without regard to its conflict-of-laws rules. Disputes go to the
            state or federal courts located in Georgia, and you and we consent
            to the jurisdiction of those courts.
          </p>

          <SectionHeader>Contact us</SectionHeader>
          <p>
            Formal legal notices, including copyright complaints:{" "}
            <a
              href={`mailto:${LEGAL_CONTACT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {LEGAL_CONTACT_EMAIL}
            </a>
            . Questions about these Terms or a decision we&rsquo;ve made:{" "}
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
