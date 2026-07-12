/**
 * trusthalal.org/get — the single link every social post points at.
 *
 * One job: turn a curious visitor into an alpha tester. Detects the
 * phone and floats the right store button up (see GetButtons), then
 * gives just enough proof (three trust points) and routes the two
 * other audiences — owners and verifiers — without cluttering the
 * primary download action.
 *
 * Same v2 language as the rest of trusthalal.org: emerald accent, ink
 * text, white surfaces on the faint neutral canvas, Inter-only type.
 */
import type { Metadata } from "next";
import { ArrowIcon, Footer, Header } from "@/components/chrome";
import { GetButtons } from "@/components/get-buttons";
import { OWNER_URL, VERIFIER_URL } from "@/lib/links";

const TITLE = "Get Trust Halal — join the Atlanta alpha";
const DESCRIPTION =
  "Find halal spots you can actually trust — verified in person, certificates on file. We're in early alpha in Atlanta and looking for founding testers. Install on iPhone or Android.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: "https://trusthalal.org/get",
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default function GetPage() {
  return (
    <div className="relative overflow-x-clip">
      <Backdrop />
      <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 pb-24 pt-8 sm:pt-10">
        <Header />

        {/* Hero + download */}
        <section className="flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1.5 text-[13px] font-medium text-accent-deep">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Early access · Atlanta first
          </span>

          <h1 className="mt-6 max-w-2xl text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Halal you can{" "}
            <em className="font-semibold not-italic text-accent-deep">actually trust.</em>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-sub">
            Find halal spots near you and see exactly how each &ldquo;halal&rdquo; claim is
            backed — before you sit down. We&rsquo;re in early alpha in Atlanta and looking for
            founding testers.
          </p>

          <div className="mt-9 flex w-full flex-col items-center">
            <GetButtons />
          </div>
        </section>

        {/* Three trust points */}
        <section className="mx-auto mt-20 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
          <TrustPoint
            title="See what backs the claim"
            body="Every place shows its trust level — owner-attested, certificate on file, or verified in person."
          />
          <TrustPoint
            title="View the real certificate"
            body="Open the actual halal certificate in the app. Plus per-meat sourcing, alcohol and pork policy."
          />
          <TrustPoint
            title="Checked by real visits"
            body="Verifiers eat there, file honest reports, and disclose who paid. No quiet edits, no hidden bias."
          />
        </section>

        {/* Route the other two audiences */}
        <section className="mx-auto mt-16 grid w-full max-w-3xl gap-4 sm:grid-cols-2">
          <AudienceCard
            title="Own a halal spot?"
            body="Get listed free and show diners exactly what backs your kitchen. Verified places stand out."
            cta="Get your place listed"
            href={OWNER_URL}
          />
          <AudienceCard
            title="Out a few times a week?"
            body="Become a Trust Halal verifier. One visit a month, one honest report, your name on the badge."
            cta="Become a verifier"
            href={VERIFIER_URL}
          />
        </section>

        <p className="mt-16 text-center text-sm text-sub">
          It&rsquo;s early and rough in places — that&rsquo;s the point. Your feedback now shapes
          what Trust Halal becomes.
        </p>
      </main>
      <Footer />
    </div>
  );
}

function TrustPoint({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-left">
      <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-sub">{body}</p>
    </div>
  );
}

function AudienceCard({
  title,
  body,
  cta,
  href,
}: {
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-6 text-left">
      <h3 className="text-lg font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-sub">{body}</p>
      <a
        href={href}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-deep transition hover:gap-2.5"
      >
        {cta}
        <ArrowIcon />
      </a>
    </div>
  );
}

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[640px]">
      <div
        className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(14,159,110,0.14), transparent)" }}
      />
      <div
        className="absolute -top-24 left-[-12%] h-[420px] w-[420px] rounded-full opacity-70 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(14,159,110,0.05), transparent)" }}
      />
    </div>
  );
}
