"use client";

/**
 * Consumer "forgot password" — request a reset link.
 *
 * Always shows the same "check your inbox" confirmation whether or not
 * the email matches an account (the API is silent by design), so this
 * page can't be used to probe which emails are registered.
 */

import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { useForgotPassword } from "@/lib/api/hooks";
import { BRAND_NAME } from "@/lib/branding";

export default function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (forgot.isPending) return;
    setErrorMsg(null);
    try {
      await forgot.mutateAsync({ email, audience: "consumer" });
      setSent(true);
    } catch (err) {
      // The endpoint returns 200 for any real request; a thrown error is
      // a transport/5xx problem. Anything below 500 we still treat as
      // "sent" to preserve the no-enumeration contract.
      if (err instanceof ApiError && err.status < 500) {
        setSent(true);
      } else {
        setErrorMsg("Something went wrong. Please try again in a moment.");
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <Link
        href="/"
        className="mb-6 text-lg font-semibold tracking-tight transition hover:opacity-80"
      >
        {BRAND_NAME}
      </Link>

      <div className="w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm">
        {sent ? (
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Check your email
            </h1>
            <p className="text-sm text-muted-foreground">
              If an account exists for{" "}
              <span className="font-medium text-foreground">{email}</span>,
              we&rsquo;ve sent a link to reset your password. It expires in an
              hour.
            </p>
            <p className="text-sm text-muted-foreground">
              Didn&rsquo;t get it? Check spam, or{" "}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                try another email
              </button>
              .
            </p>
            <Link
              href="/login"
              className="inline-block pt-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                Reset your password
              </h1>
              <p className="text-sm text-muted-foreground">
                Enter your email and we&rsquo;ll send you a reset link.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                disabled={forgot.isPending}
              />
            </div>

            {errorMsg && (
              <p className="text-sm text-destructive" role="alert" aria-live="polite">
                {errorMsg}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={forgot.isPending || !email}
            >
              {forgot.isPending ? "Sending…" : "Send reset link"}
            </Button>

            <p className="text-xs text-muted-foreground">
              Remembered it?{" "}
              <Link
                href="/login"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
