/**
 * Shared page chrome for trusthalal.org — header, footer, brand
 * mark, and the small arrow icon. Extracted from the landing page
 * when /ethics arrived so both pages render identical chrome
 * without copy-paste drift.
 *
 * Server components only; zero client JS.
 */

import {
  ADMIN_URL,
  CONSUMER_URL,
  CONTACT_EMAIL,
  ETHICS_PATH,
  OWNER_URL,
  PRIVACY_PATH,
  DELETE_ACCOUNT_PATH,
  TERMS_PATH,
  SUPPORT_PATH,
  VERIFIER_URL,
} from "@/lib/links";

export function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-onaccent shadow-sm"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

export function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/**
 * Site header. Section anchors are rooted at "/#…" so they work
 * from any page, not just the landing.
 */
export function Header() {
  return (
    <header className="mb-16 flex items-center justify-between gap-4 sm:mb-24">
      <a href="/" className="flex items-center gap-2.5 transition hover:opacity-80">
        <BrandMark />
        <span className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          Trust Halal
        </span>
      </a>
      <div className="flex items-center gap-5">
        <nav
          aria-label="Sections"
          className="hidden items-center gap-5 text-sm text-sub md:flex"
        >
          <a href="/#how-it-works" className="transition hover:text-ink">
            How it works
          </a>
          <a href="/#tiers" className="transition hover:text-ink">
            Verification tiers
          </a>
          <a href={ETHICS_PATH} className="transition hover:text-ink">
            Ethics
          </a>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="transition hover:text-ink"
          >
            Contact
          </a>
        </nav>
        <a
          href={CONSUMER_URL}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-onaccent shadow-sm transition hover:bg-accent-deep"
        >
          Find halal food near you
          <ArrowIcon />
        </a>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10 grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <BrandMark />
              <span className="text-xl font-semibold tracking-tight text-ink">
                Trust Halal
              </span>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-sub">
              The open verification platform for halal restaurants.
              Independent of any specific certifying body; we accept
              certificates from any recognized halal authority.
              Verification stays free for restaurants.
            </p>
          </div>
          <FooterColumn
            title="Platform"
            links={[
              { label: "halalfoodnearme.com", href: CONSUMER_URL },
              { label: "Owner portal", href: OWNER_URL },
              { label: "Verifier program", href: VERIFIER_URL },
              { label: "Admin", href: ADMIN_URL },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { label: "AI ethics", href: ETHICS_PATH },
              { label: "Privacy", href: PRIVACY_PATH },
              { label: "Terms", href: TERMS_PATH },
              { label: "Delete account", href: DELETE_ACCOUNT_PATH },
              { label: "Support", href: SUPPORT_PATH },
              {
                label: CONTACT_EMAIL,
                href: `mailto:${CONTACT_EMAIL}`,
              },
            ]}
          />
        </div>
        <p className="border-t border-line pt-6 text-xs text-sub">
          © {new Date().getFullYear()} Trust Halal. Community-built,
          Muslim-led.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ label: string; href: string }>;
}) {
  return (
    <nav aria-label={title}>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-sub">
        {title}
      </h3>
      <ul className="space-y-2 text-sm text-sub">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="transition hover:text-ink hover:underline">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
