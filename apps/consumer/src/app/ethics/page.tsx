/**
 * /ethics — Trust Halal's public AI ethics document.
 *
 * Server-rendered so shared links (from the vlog, press, community
 * threads) land with proper OG tags. Full text is hand-written as
 * JSX here; the canonical source of truth lives at
 * ``content/ethics/ai-ethics.md`` and both should stay in sync when
 * edited. The `changeHistory` table at the bottom is authoritative
 * — every substantive change gets a row.
 *
 * Style: prose-first, minimal chrome, generous whitespace. This is
 * a document, not a marketing page.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { BRAND_NAME } from "@/lib/branding";

const PAGE_TITLE = `How ${BRAND_NAME} uses AI`;
const PAGE_DESCRIPTION =
  "Every 'Trust Halal Verified' designation is made by a human. AI helps us work faster; AI does not decide whether a restaurant is halal. Here's exactly how we use it, and where we draw the lines.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/ethics" },
  openGraph: {
    type: "article",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: "/ethics",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
};

export default function EthicsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <nav className="mb-8 text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          {BRAND_NAME}
        </Link>
        <span className="mx-2">·</span>
        <span>Ethics</span>
      </nav>

      <article className="prose-friendly">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
          How Trust Halal uses AI
        </p>
        <h1 className="mb-6 font-serif text-4xl font-semibold leading-tight sm:text-5xl">
          Every &lsquo;Verified&rsquo; designation is made by a human.
        </h1>
        <p className="mb-8 text-lg text-muted-foreground sm:text-xl">
          AI helps us work faster; AI does not decide whether a
          restaurant is halal. This is the source-of-truth
          document for how we use it, and where we draw the lines.
        </p>

        <IntroSection />
        <OneLineVersion />
        <WhyWritingSection />

        <SectionHeader>What AI does at Trust Halal</SectionHeader>
        <PriorityScoring />
        <ConsistencyFlagging />
        <DisputeClustering />
        <CertificateOCR />

        <SectionHeader>What AI does NOT do</SectionHeader>
        <NotDoingList />

        <SectionHeader>What models we use</SectionHeader>
        <ModelsSection />

        <SectionHeader>Preventing failure cascades</SectionHeader>
        <FailureCascadesSection />

        <SectionHeader>When we make a mistake</SectionHeader>
        <MistakesSection />

        <SectionHeader>Incident log</SectionHeader>
        <IncidentLog />

        <SectionHeader>Feedback</SectionHeader>
        <FeedbackSection />

        <SectionHeader>Change history</SectionHeader>
        <ChangeHistoryTable />

        <hr className="my-10 border-border" />
        <p className="text-sm italic text-muted-foreground">
          Written by the Trust Halal team. If you&apos;d like to
          reference this document publicly, please do — the URL is{" "}
          <span className="font-mono text-foreground">
            halalfoodnearme.com/ethics
          </span>
          .
        </p>
      </article>

      <style>{`
        .prose-friendly p { margin-top: 1.1em; margin-bottom: 1.1em; color: var(--muted-foreground); font-size: 1.0625rem; line-height: 1.7; }
        .prose-friendly p strong { color: var(--foreground); }
        .prose-friendly ul { margin: 1em 0 1.5em 0; padding-left: 1.4em; color: var(--muted-foreground); }
        .prose-friendly ul li { margin-top: 0.5em; margin-bottom: 0.5em; line-height: 1.6; }
        .prose-friendly ul li strong { color: var(--foreground); }
        .prose-friendly h2 { color: var(--foreground); }
        .prose-friendly h3 { color: var(--foreground); }
        .prose-friendly a { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
      `}</style>
    </main>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-12 mb-4 font-serif text-2xl font-semibold sm:text-3xl">
      {children}
    </h2>
  );
}

function IntroSection() {
  return null; // hero handled above
}

function OneLineVersion() {
  return (
    <section className="my-10 rounded-lg border border-primary/30 bg-primary/5 p-6">
      <h2 className="mb-2 font-serif text-xl font-semibold">
        The one-line version
      </h2>
      <p className="text-base text-foreground sm:text-lg">
        <strong>
          Every &lsquo;Trust Halal Verified&rsquo; designation is made
          by a human. AI helps us work faster; AI does not decide
          whether a restaurant is halal.
        </strong>
      </p>
    </section>
  );
}

function WhyWritingSection() {
  return (
    <>
      <SectionHeader>Why we&apos;re writing this down</SectionHeader>
      <p>
        Halal is a religious concept with real weight in the lives of
        the people who follow it. Families feed their children based
        on what a restaurant says. Observant Muslims plan their meals
        around what they can trust. The word &ldquo;halal&rdquo;
        carries obligations that a marketing team can&apos;t casually
        reinterpret.
      </p>
      <p>
        The wrong AI system, deployed carelessly, could cause real
        harm. A machine that &ldquo;labels&rdquo; a restaurant as
        halal when it isn&apos;t misleads diners into eating something
        they shouldn&apos;t. A machine that flags an actually-halal
        restaurant as suspect damages a business built on integrity.
        Both undermine the community&apos;s trust in the entire
        platform.
      </p>
      <p>
        We take this seriously, and we think you deserve to know
        exactly where we draw the lines.
      </p>
    </>
  );
}

function PriorityScoring() {
  return (
    <>
      <h3 className="mt-8 mb-2 font-serif text-xl font-semibold">
        1. Priority scoring for the admin queue
      </h3>
      <p>
        When a new restaurant enters our system (through owner
        claim, verifier nomination, or public suggestion), an
        internal AI signal helps us decide which restaurants to
        review first.
      </p>
      <p>
        <strong>What it does:</strong> looks at public data — the
        restaurant&apos;s own website language, their menu, mentions
        of halal in their Google reviews, cuisine correlations,
        whether they&apos;ve uploaded a halal certificate — and
        produces a numeric score representing &ldquo;how likely is
        this restaurant to be verifiable as halal-serving?&rdquo;
        High scores go to the top of the review queue.
      </p>
      <p>
        <strong>What it doesn&apos;t do:</strong> this score is
        never shown to consumers. It doesn&apos;t determine the
        verified tier. It just decides the order our human review
        team looks at restaurants — a productivity tool that lets
        us clear the queue faster.
      </p>
      <p>
        <strong>Why it&apos;s safe:</strong> the outcome of a high
        or low score is the same — a human reviewer looks at the
        restaurant. The score just influences timing.
      </p>
    </>
  );
}

function ConsistencyFlagging() {
  return (
    <>
      <h3 className="mt-8 mb-2 font-serif text-xl font-semibold">
        2. Questionnaire consistency flagging
      </h3>
      <p>
        When a restaurant owner fills out the halal questionnaire
        (menu posture, per-meat sourcing, alcohol policy, etc.), an
        AI checker looks for internal contradictions before the
        submission reaches a human reviewer.
      </p>
      <p>
        <strong>Examples of what it flags:</strong>{" "}
        &ldquo;fully halal menu&rdquo; + &ldquo;full bar with
        cooking-with-wine&rdquo; — worth double-checking.
        &ldquo;No pork&rdquo; + a menu photo showing a pork-based
        item — needs a follow-up. &ldquo;Zabihah chicken&rdquo; + a
        supplier known not to offer zabihah — worth verifying.
      </p>
      <p>
        <strong>What it doesn&apos;t do:</strong> it doesn&apos;t
        approve or reject anything. Every flagged item still gets a
        human review; the flag just tells the reviewer where to
        look first.
      </p>
      <p>
        <strong>Why it&apos;s safe:</strong> the reviewer sees the
        flag and the raw data. If the AI&apos;s flag is wrong, the
        reviewer discounts it. The flag is advisory, never
        determinative.
      </p>
    </>
  );
}

function DisputeClustering() {
  return (
    <>
      <h3 className="mt-8 mb-2 font-serif text-xl font-semibold">
        3. Dispute pattern clustering
      </h3>
      <p>
        When multiple consumers file disputes about the same
        restaurant or the same claim, AI helps us cluster the
        disputes by common attributes — same supplier mentioned,
        same menu item mentioned, same time period mentioned — so
        admin can see the pattern quickly.
      </p>
      <p>
        <strong>What it does:</strong> groups similar disputes.
        &ldquo;Three separate diners all mentioned the chicken
        supplier changing in the last month&rdquo; becomes a
        visible pattern instead of three unrelated tickets.
      </p>
      <p>
        <strong>What it doesn&apos;t do:</strong> it doesn&apos;t
        decide whether the disputes are valid. It doesn&apos;t
        automatically flip a restaurant&apos;s status. It
        doesn&apos;t remove the badge.
      </p>
      <p>
        <strong>Why it&apos;s safe:</strong> the clustering is a
        lens on the data, not a judgment about it. Admin still
        reads every dispute and makes every decision.
      </p>
    </>
  );
}

function CertificateOCR() {
  return (
    <>
      <h3 className="mt-8 mb-2 font-serif text-xl font-semibold">
        4. Certificate OCR + metadata extraction
      </h3>
      <p>
        When a restaurant uploads a halal certificate PDF or image,
        AI extracts the structured data — certifying body name,
        certificate number, issue date, expiry date, restaurant
        name on the cert — and pre-populates the admin review form.
      </p>
      <p>
        <strong>What it does:</strong> saves the reviewer from
        re-typing the info. The reviewer confirms the extraction is
        correct before it commits to the restaurant&apos;s record.
      </p>
      <p>
        <strong>What it doesn&apos;t do:</strong> it doesn&apos;t
        decide whether a certificate is legitimate. It doesn&apos;t
        rank certifying bodies. It doesn&apos;t approve or reject
        certificates.
      </p>
      <p>
        <strong>Why it&apos;s safe:</strong> the reviewer sees the
        original cert alongside the extracted data. If the OCR got
        a number wrong, they fix it. The AI is a scanner, not a
        judge.
      </p>
    </>
  );
}

function NotDoingList() {
  return (
    <ul>
      <li>
        <strong>AI does not determine whether a restaurant is halal.</strong>{" "}
        Every &ldquo;Self-attested,&rdquo; &ldquo;Certificate on
        file,&rdquo; and &ldquo;Trust Halal Verified&rdquo; tier is
        decided by a human reviewer or, for the top tier, by a
        human verifier&apos;s in-person visit plus a human
        admin&apos;s review.
      </li>
      <li>
        <strong>AI does not appear as a signal to consumers.</strong>{" "}
        No &ldquo;AI-scored&rdquo; or &ldquo;AI-rated&rdquo; badge,
        no &ldquo;our algorithm says&rdquo; copy anywhere on the
        public site.
      </li>
      <li>
        <strong>
          AI does not evaluate the legitimacy of certifying bodies.
        </strong>{" "}
        IFANCA vs. HFSAA vs. a local mosque&apos;s certification is
        a question about religious authority, not a
        machine-learning problem. We stay neutral.
      </li>
      <li>
        <strong>
          AI does not read the Qur&apos;an, hadith, or interpret
          religious rulings.
        </strong>{" "}
        Halal is a religious concept. We use AI to organize data
        about restaurants; we don&apos;t use it to make religious
        judgments.
      </li>
      <li>
        <strong>AI does not process private data without disclosure.</strong>{" "}
        If we ever add a feature that involves AI reading private
        user data (e.g. dispute descriptions to route them to
        admin), we&apos;ll say so, here and in-product.
      </li>
      <li>
        <strong>AI does not replace verifier visits.</strong> The
        whole point of the Trust Halal Verified tier is that a real
        community verifier ate there. That doesn&apos;t get
        automated.
      </li>
    </ul>
  );
}

function ModelsSection() {
  return (
    <>
      <p>
        For the record, our AI-assisted admin tools currently use
        large language models via Anthropic&apos;s Claude API
        (specifically the Sonnet and Haiku model families) and OCR
        via a combination of tesseract-based open-source tools and
        cloud vision APIs. The models are called through our own
        backend; user-submitted data is not fed into third-party
        training pipelines beyond the operational scope of our
        vendors&apos; privacy commitments.
      </p>
      <p>
        We&apos;ll update this section when the models change.
      </p>
    </>
  );
}

function FailureCascadesSection() {
  return (
    <ul>
      <li>
        <strong>Model hallucination on consistency flagging.</strong>{" "}
        Every flag is advisory. A confidently-wrong AI flag
        doesn&apos;t take any action; it just points at a field
        the reviewer looks at. Reviewer overrides
        &ldquo;unflag&rdquo; the item.
      </li>
      <li>
        <strong>OCR misreading a certificate.</strong> The reviewer
        sees the original document alongside the extracted values.
        Wrong extractions get corrected before commit.
      </li>
      <li>
        <strong>Priority scoring bias.</strong> A biased priority
        score doesn&apos;t approve or reject anything — it changes
        review order. If we notice systemic ordering bias (e.g.
        under-scoring restaurants from a particular region or
        cuisine), we adjust or remove the scorer.
      </li>
      <li>
        <strong>Model outage.</strong> All our human review paths
        work without AI. If the AI service is down, our admins
        still review restaurants normally, just at a slower pace.
      </li>
    </ul>
  );
}

function MistakesSection() {
  return (
    <>
      <p>
        If the AI-assisted pipeline contributes to a bad decision —
        a restaurant is verified when it shouldn&apos;t be, or vice
        versa — here&apos;s what happens:
      </p>
      <ol className="my-4 list-decimal space-y-2 pl-6 text-base text-muted-foreground">
        <li>
          <strong className="text-foreground">
            We correct the record publicly.
          </strong>{" "}
          The listing is updated with a clear explanation of what
          changed and why.
        </li>
        <li>
          <strong className="text-foreground">
            We tell the affected parties.
          </strong>{" "}
          The restaurant, the disputing consumer, and any verifier
          involved are contacted.
        </li>
        <li>
          <strong className="text-foreground">
            We audit the pipeline step.
          </strong>{" "}
          Which AI signal contributed to the wrong decision? Was it
          a systemic issue or a one-off?
        </li>
        <li>
          <strong className="text-foreground">We write it up.</strong>{" "}
          Major AI-related trust incidents get documented in this
          page&apos;s incident log below.
        </li>
      </ol>
    </>
  );
}

function IncidentLog() {
  return (
    <p className="italic">
      Empty as of publication. Any AI-related trust incident that
      meaningfully affects a diner, an owner, or a verifier will be
      logged here with a date, description, and outcome.
    </p>
  );
}

function FeedbackSection() {
  return (
    <>
      <p>
        If you think we&apos;ve drawn a line in the wrong place —
        if you believe AI shouldn&apos;t be involved in one of the
        four internal roles listed above, or if you think we should
        be doing more or less with AI than we&apos;re doing — we
        want to hear it.
      </p>
      <p>
        Email us at{" "}
        <a href="mailto:ethics@trusthalal.org">
          ethics@trusthalal.org
        </a>
        . We read every message. We won&apos;t necessarily agree,
        but we&apos;ll respond.
      </p>
    </>
  );
}

function ChangeHistoryTable() {
  return (
    <div className="my-4 overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="p-3 text-left font-semibold">Date</th>
            <th className="p-3 text-left font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <td className="p-3 text-muted-foreground">
              (publication date)
            </td>
            <td className="p-3">First published.</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
