"use client";

/**
 * Consumer "confirm your email" landing page.
 *
 * Reads ?token= and redeems it on mount. Deliberately auto-submits rather
 * than showing a "click here to confirm" button: the user already clicked a
 * button — the one in the email — and asking them to click a second one to
 * express the same intent is friction with no security benefit.
 *
 * Three terminal states: confirmed, already-confirmed (a second click on the
 * same link, or a link that raced another device — treated as success, not
 * an error), and dead link. The dead-link state offers Resend rather than a
 * shrug, since "the link expired" is the single most common way this page
 * gets seen.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import {
  useCurrentUser,
  useResendVerification,
  useVerifyEmail,
} from "@/lib/api/hooks";
import { BRAND_NAME } from "@/lib/branding";

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyEmailInner />
    </React.Suspense>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <Link
        href="/"
        className="mb-6 text-lg font-semibold tracking-tight transition hover:opacity-80"
      >
        {BRAND_NAME}
      </Link>
      <div className="w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? null;

  const me = useCurrentUser();
  const verify = useVerifyEmail();
  const resend = useResendVerification();

  const [status, setStatus] = React.useState<
    "idle" | "working" | "done" | "already" | "failed"
  >(token ? "working" : "failed");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Redeem once on mount. The ref guard matters in React 18 StrictMode,
  // where effects run twice in dev — without it the second call would burn
  // a token that the first call already consumed and we'd render a failure
  // on a link that actually worked.
  const attempted = React.useRef(false);
  React.useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    verify
      .mutateAsync({ token })
      .then((res) => {
        setStatus(res.already_verified ? "already" : "done");
      })
      .catch((err) => {
        const { description } = friendlyApiError(err, {
          defaultTitle: "Couldn't confirm your email",
          overrides: {
            VERIFICATION_INVALID: {
              title: "",
              description:
                "This confirmation link is invalid, expired, or already used.",
            },
          },
        });
        setErrorMsg(description);
        setStatus("failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (status === "working") {
    return (
      <AuthShell>
        <p className="text-sm text-muted-foreground">Confirming your email…</p>
      </AuthShell>
    );
  }

  if (status === "done" || status === "already") {
    return (
      <AuthShell>
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {status === "already" ? "Already confirmed" : "Email confirmed"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {status === "already"
              ? "This address was already confirmed — you're all set."
              : "Thanks. You can now post reviews and help other diners find trustworthy halal food."}
          </p>
          <Button asChild className="mt-2 w-full">
            <Link href="/">Find halal food near you</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Dead link. If they happen to be signed in on this device we can offer a
  // one-tap resend; if not, the honest instruction is to sign in first,
  // because the resend endpoint reads the address off the session rather
  // than trusting one typed into a form.
  const signedIn = Boolean(me.data?.id);
  const alreadyVerified = me.data?.email_verified === true;

  return (
    <AuthShell>
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
        <p className="text-sm text-muted-foreground">
          {errorMsg ??
            "This confirmation link is invalid, expired, or already used."}
        </p>

        {alreadyVerified ? (
          <p className="text-sm text-muted-foreground">
            Good news though — your email is already confirmed. Nothing else to do.
          </p>
        ) : signedIn ? (
          <div className="space-y-2 pt-1">
            {resend.isSuccess ? (
              <p className="text-sm text-emerald-600">
                {resend.data?.sent
                  ? `Sent. Check ${resend.data.email} for a fresh link.`
                  : "Your email is already confirmed — nothing else to do."}
              </p>
            ) : (
              <Button
                className="w-full"
                disabled={resend.isPending}
                onClick={() => resend.mutate({ audience: "consumer" })}
              >
                {resend.isPending ? "Sending…" : "Send me a new link"}
              </Button>
            )}
            {resend.isError && (
              <p className="text-sm text-destructive" role="alert">
                Couldn&rsquo;t send that. Try again in a moment.
              </p>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="inline-block pt-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in to request a new link
          </Link>
        )}
      </div>
    </AuthShell>
  );
}
