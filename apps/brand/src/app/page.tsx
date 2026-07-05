/**
 * trusthalal.org landing.
 *
 * A single page. Explains what Trust Halal is in one sentence,
 * then routes visitors to the right surface for their role:
 *
 *   - Diners → halalfoodnearme.com
 *   - Restaurant owners → owner.trusthalal.org
 *   - Verifiers → halalfoodnearme.com/become-a-verifier
 *   - Admin login lives in the footer, not the primary cards.
 *
 * Server-rendered, no hydration cost. Uses the same warm palette
 * as the family of apps but doesn't share the design system —
 * this page's Tailwind footprint is intentionally self-contained.
 */

const CONSUMER_URL = "https://halalfoodnearme.com";
const OWNER_URL = "https://owner.trusthalal.org";
const VERIFIER_URL = "https://halalfoodnearme.com/become-a-verifier";
const ADMIN_URL = "https://admin.trusthalal.org";
const ETHICS_URL = "https://halalfoodnearme.com/ethics";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12 sm:py-20">
      <Header />
      <Hero />
      <Cards />
      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="mb-12 flex items-center justify-between sm:mb-16">
      <div className="flex items-center gap-2">
        <div
          aria-hidden="true"
          className="h-3 w-3 rounded-sm bg-olive"
        />
        <span
          className="font-serif text-lg font-semibold tracking-tight text-stone sm:text-xl"
        >
          Trust Halal
        </span>
      </div>
      <nav className="flex items-center gap-4 text-xs text-stone/70 sm:text-sm">
        <a
          href={ETHICS_URL}
          className="hover:text-stone hover:underline"
        >
          Ethics
        </a>
        <a
          href="mailto:hello@trusthalal.org"
          className="hover:text-stone hover:underline"
        >
          Contact
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="mb-14 sm:mb-20">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-olive">
        Community-built. Muslim-led.
      </p>
      <h1 className="mb-5 font-serif text-4xl font-semibold leading-tight text-stone sm:text-6xl">
        The halal restaurants you can actually trust.
      </h1>
      <p className="max-w-2xl text-lg text-stone/70 sm:text-xl">
        Trust Halal is a verified directory of halal restaurants.
        We check what&apos;s on the plate &mdash; supplier,
        slaughter method, certificate on file &mdash; so diners
        don&apos;t have to call the kitchen first.
      </p>
    </section>
  );
}

function Cards() {
  return (
    <section className="mb-16 sm:mb-20">
      <h2 className="mb-6 text-xs font-semibold uppercase tracking-widest text-olive">
        Where do you want to go?
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          eyebrow="For diners"
          title="Find verified halal restaurants"
          body="Search halalfoodnearme.com — filter by menu posture, sourcing, and certification."
          cta="Browse restaurants"
          href={CONSUMER_URL}
        />
        <Card
          eyebrow="For restaurant owners"
          title="Get your restaurant verified"
          body="Free verification. Public listing plus a Trust Halal Verified badge for your window."
          cta="Apply for verification"
          href={OWNER_URL}
        />
        <Card
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

function Card({
  eyebrow,
  title,
  body,
  cta,
  href,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group flex flex-col rounded-lg border border-sand/60 bg-white/60 p-5 transition hover:border-olive/50 hover:bg-white sm:p-6"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-olive/80">
        {eyebrow}
      </p>
      <h3 className="mb-2 font-serif text-xl font-semibold text-stone sm:text-2xl">
        {title}
      </h3>
      <p className="mb-6 flex-1 text-sm text-stone/70 sm:text-base">
        {body}
      </p>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-stone transition group-hover:text-olive">
        {cta}
        <span aria-hidden="true">→</span>
      </span>
    </a>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-sand/60 pt-8 text-sm text-stone/60">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md">
          Trust Halal is independent of any specific certifying body
          and accepts certificates from any recognized halal
          authority. Verification stays free for restaurants.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <a href={ETHICS_URL} className="hover:text-stone hover:underline">
            AI ethics
          </a>
          <a
            href="mailto:hello@trusthalal.org"
            className="hover:text-stone hover:underline"
          >
            hello@trusthalal.org
          </a>
          <a
            href={ADMIN_URL}
            className="hover:text-stone hover:underline"
          >
            Admin
          </a>
        </div>
      </div>
    </footer>
  );
}
