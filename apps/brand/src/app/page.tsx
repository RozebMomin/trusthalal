/**
 * trusthalal.org landing — 2026 redesign.
 *
 * Still a single server-rendered page with zero client JS, but it
 * now tells the whole story instead of just routing:
 *
 *   1. Hero — brand promise + primary CTAs + trust strip.
 *   2. How verification works — the 3-step pipeline (claim →
 *      in-person visit → living public profile).
 *   3. Verification tiers — the trust ladder, rendered with the
 *      same pill language the consumer site uses so the badge a
 *      visitor sees later is already familiar.
 *   4. Audience cards — diners / owners / verifiers routing.
 *   5. Principles band — independence + paid-meal disclosure, the
 *      two commitments that differentiate the platform.
 *   6. Footer — structured product / contact columns.
 *
 * Design system: the v2 clean-modern language shared with the
 * consumer site and mobile app — emerald accent, ink text, white
 * surfaces on a faint neutral canvas, Inter-only type (no serif).
 * Self-contained (no shadcn, no shared tokens). Decorative
 * backgrounds are pure CSS gradients — no image requests.
 */

import { ArrowIcon, Footer, Header } from "@/components/chrome";
import {
  CONSUMER_URL,
  ETHICS_PATH,
  OWNER_GET_VERIFIED_URL,
  VERIFIER_URL,
} from "@/lib/links";

export default function HomePage() {
  return (
    <div className="relative overflow-x-clip">
      <HeroBackdrop />
      <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 pb-0 pt-8 sm:pt-10">
        <Header />
        <Hero />
        <HowItWorks />
        <Tiers />
        <Audiences />
      </main>
      <PrinciplesBand />
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decorative backdrop — layered radial washes behind the hero. Pure
// CSS, aria-hidden, pointer-events-none. Subtle by design: the page
// should feel like warm paper with light falling on it, not a SaaS
// gradient blast.
// ---------------------------------------------------------------------------
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[720px]">
      <div
        className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(14,159,110,0.14), transparent)",
        }}
      />
      <div
        className="absolute -top-24 left-[-12%] h-[420px] w-[420px] rounded-full opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(14,159,110,0.05), transparent)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------
function Hero() {
  return (
    <section className="mb-24 sm:mb-32">
      <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-white/50 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
        Community-built · Muslim-led
      </p>
      <h1 className="mb-6 max-w-3xl tracking-tight text-5xl font-semibold leading-[1.05] text-ink sm:text-7xl">
        The source of truth
        <br className="hidden sm:block" />{" "}
        for <em className="text-accent">halal.</em>
      </h1>
      <p className="mb-9 max-w-2xl text-lg leading-relaxed text-sub sm:text-xl">
        Trust Halal is the definitive record of halal restaurants. Every
        claim is checked at the source &mdash; supplier, slaughter
        method, certificate on file, and an in-person visit &mdash; so no
        one has to call the kitchen and hope.
      </p>
      <div className="mb-12 flex flex-wrap items-center gap-3">
        <a
          href={CONSUMER_URL}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-base font-medium text-onaccent shadow-md shadow-accent/20 transition hover:-translate-y-0.5 hover:bg-accent-deep hover:shadow-lg hover:shadow-accent/25"
        >
          Browse verified restaurants
          <ArrowIcon />
        </a>
        <a
          href={OWNER_GET_VERIFIED_URL}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-white/60 px-6 py-3 text-base font-medium text-ink transition hover:border-accent/50 hover:bg-white"
        >
          Verify your restaurant
        </a>
      </div>
      {/* Trust strip — the three commitments in one glance. */}
      <ul className="flex flex-wrap items-center gap-x-7 gap-y-2 text-sm text-sub">
        <TrustItem>Independent of any certifying body</TrustItem>
        <TrustItem>Free for restaurants, forever</TrustItem>
        <TrustItem>Every paid meal disclosed</TrustItem>
      </ul>
    </section>
  );
}

function TrustItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2">
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#0E9F6E"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {children}
    </li>
  );
}

// ---------------------------------------------------------------------------
// How verification works — the 3-step pipeline. Numbered editorial
// cards; the connecting thread is the accent number.
// ---------------------------------------------------------------------------
function HowItWorks() {
  return (
    <section id="how-it-works" className="mb-24 scroll-mt-24 sm:mb-32">
      <SectionHeading
        eyebrow="How it works"
        title="Verification you can follow, step by step."
        lede="No black box. Every profile shows exactly how its halal claim was checked — and by whom."
      />
      <ol className="grid gap-4 sm:grid-cols-3">
        <Step
          n="1"
          title="The claim"
          body="A restaurant owner submits their halal details — menu coverage, meat sourcing, slaughter method, certificate — with evidence attached."
        />
        <Step
          n="2"
          title="The visit"
          body="A Trust Halal Verifier from the community eats there and files a short, honest report. Who paid for the meal is always disclosed."
        />
        <Step
          n="3"
          title="The living profile"
          body="The public listing shows the verification tier, the evidence, and any open disputes. If something changes, the community can flag it."
        />
      </ol>
    </section>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="relative rounded-2xl border border-line bg-white/60 p-6 transition hover:border-accent/40 hover:bg-white sm:p-7">
      <p
        aria-hidden="true"
        className="mb-4 tracking-tight text-5xl font-semibold leading-none text-accent/25"
      >
        {n}
      </p>
      <h3 className="mb-2 tracking-tight text-2xl font-semibold text-ink">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-sub sm:text-base">
        {body}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Verification tiers — the trust ladder. The pills intentionally
// mirror the consumer site's tone system (slate → amber → accent) so
// the badge a diner meets on halalfoodnearme.com already means
// something.
// ---------------------------------------------------------------------------
function Tiers() {
  return (
    <section id="tiers" className="mb-24 scroll-mt-24 sm:mb-32">
      <SectionHeading
        eyebrow="Verification tiers"
        title="Trust, earned in three steps."
        lede="Every listing wears its level of proof on its sleeve. Higher tiers require stronger, third-party evidence."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TierCard
          pill="Owner-attested"
          pillClass="border-slate-300 bg-slate-50 text-slate-900"
          title="The owner says so"
          body="The restaurant has filed a halal claim with details on sourcing and preparation. Honest, but not yet independently checked."
        />
        <TierCard
          pill="Halal certified"
          pillClass="border-amber-300 bg-amber-50 text-amber-900"
          title="Certificate on file"
          body="A current certificate from a recognized halal authority is on record with us — any authority; we're independent of them all."
        />
        <TierCard
          pill="✓ Verified halal"
          pillClass="border-accent bg-accent text-onaccent"
          title="Confirmed in person"
          body="A Trust Halal Verifier physically visited, ate, and confirmed the claim. The strongest signal we award — and it can be lost."
          featured
        />
      </div>
    </section>
  );
}

function TierCard({
  pill,
  pillClass,
  title,
  body,
  featured = false,
}: {
  pill: string;
  pillClass: string;
  title: string;
  body: string;
  featured?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-6 transition sm:p-7",
        featured
          ? "border-accent/50 bg-white shadow-lg shadow-accent/10"
          : "border-line bg-white/60 hover:border-accent/40 hover:bg-white",
      ].join(" ")}
    >
      <span
        className={`mb-4 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${pillClass}`}
      >
        {pill}
      </span>
      <h3 className="mb-2 tracking-tight text-2xl font-semibold text-ink">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-sub sm:text-base">
        {body}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audience routing cards — same three destinations as before, now
// with icons and button-weight CTAs.
// ---------------------------------------------------------------------------
function Audiences() {
  return (
    <section className="mb-24 sm:mb-32">
      <SectionHeading
        eyebrow="Where do you want to go?"
        title="One platform, three doors."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <AudienceCard
          icon={<SearchIcon />}
          eyebrow="For diners"
          title="Find verified halal restaurants"
          body="Search halalfoodnearme.com — filter by menu coverage, sourcing, and certification."
          cta="Browse restaurants"
          href={CONSUMER_URL}
        />
        <AudienceCard
          icon={<StoreIcon />}
          eyebrow="For restaurant owners"
          title="Get your restaurant verified"
          body="Free verification. Public listing plus a Trust Halal Verified badge for your window."
          cta="Apply for verification"
          href={OWNER_GET_VERIFIED_URL}
        />
        <AudienceCard
          icon={<FlagIcon />}
          eyebrow="For the community"
          title="Become a Trust Halal Verifier"
          body="You visit halal spots anyway. Help the community trust where they eat."
          cta="Apply to be a verifier"
          href={VERIFIER_URL}
        />
      </div>
    </section>
  );
}

function AudienceCard({
  icon,
  eyebrow,
  title,
  body,
  cta,
  href,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group flex flex-col rounded-2xl border border-line bg-white/60 p-6 transition hover:-translate-y-1 hover:border-accent/50 hover:bg-white hover:shadow-lg hover:shadow-accent/10 sm:p-7"
    >
      <span
        aria-hidden="true"
        className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-onaccent"
      >
        {icon}
      </span>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/80">
        {eyebrow}
      </p>
      <h3 className="mb-2 tracking-tight text-2xl font-semibold text-ink">
        {title}
      </h3>
      <p className="mb-7 flex-1 text-sm leading-relaxed text-sub sm:text-base">
        {body}
      </p>
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
        {cta}
        <span className="transition group-hover:translate-x-1">
          <ArrowIcon />
        </span>
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Principles band — deep accent full-bleed section carrying the two
// commitments that define the platform, plus the ethics link and a
// final CTA. Doubling as the page's closing statement.
// ---------------------------------------------------------------------------
function PrinciplesBand() {
  return (
    <section aria-label="Our principles" className="bg-accent-deep text-onaccent">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-onaccent/60">
          Our principles
        </p>
        <blockquote className="mb-10 max-w-3xl tracking-tight text-3xl font-semibold leading-snug sm:text-5xl">
          Trust is the product. So every visit discloses who paid for
          the meal &mdash; and no certifying body owns us.
        </blockquote>
        <div className="mb-12 grid gap-6 text-onaccent/80 sm:grid-cols-2">
          <p className="text-sm leading-relaxed sm:text-base">
            <strong className="text-onaccent">Independent.</strong> Trust
            Halal is not owned by, funded by, or affiliated with any
            certifying body. We accept certificates from any
            recognized halal authority and verify them ourselves.
          </p>
          <p className="text-sm leading-relaxed sm:text-base">
            <strong className="text-onaccent">Disclosed.</strong> Hiding
            a comped meal or a paid arrangement is the one thing that
            gets a verifier removed from the program. Honest beats
            polished, every time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <a
            href={CONSUMER_URL}
            className="inline-flex items-center gap-2 rounded-full bg-surface px-6 py-3 text-base font-semibold text-accent-deep transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20"
          >
            Know before you eat
            <ArrowIcon />
          </a>
          <a
            href={ETHICS_PATH}
            className="text-sm font-medium text-onaccent/80 underline-offset-4 transition hover:text-onaccent hover:underline"
          >
            Read the full ethics commitment →
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function SectionHeading({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="mb-10">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
        {eyebrow}
      </p>
      <h2 className="max-w-2xl tracking-tight text-3xl font-semibold leading-tight text-ink sm:text-5xl">
        {title}
      </h2>
      {lede && (
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-sub sm:text-lg">
          {lede}
        </p>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m2 7 4.4-4.4A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7" />
      <path d="M4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7" />
      <path d="M15 21v-6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v6" />
      <path d="M2 7h20" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.3 2 1 0 2-.2 2.7-.6a1 1 0 0 1 1.5.9v10.4a1 1 0 0 1-.4.8 6 6 0 0 1-3.5 1.2c-3 0-5-2-7.3-2-1.3 0-2.4.3-3.3.8" />
    </svg>
  );
}
