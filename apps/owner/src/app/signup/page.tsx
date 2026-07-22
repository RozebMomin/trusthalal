"use client";

/**
 * Owner portal signup.
 *
 * Public, self-service path for restaurant owners. Trust Halal staff
 * deliberately do NOT mint OWNER accounts by hand anymore — owners
 * sign up, then submit ownership claims that staff review. The trust
 * gate is downstream at the claim step, not at the email gate, so
 * this form is intentionally light: email + password + display name.
 *
 * The server hard-codes role=OWNER and auto-logs the new user in by
 * setting the session cookie on success — same response shape as
 * /auth/login, so we just route to "/" and let AppShell take over.
 *
 * Failure modes worth surfacing in the UI:
 *   * EMAIL_TAKEN  → "this email is already registered, sign in" with
 *                    a deep-link to /login.
 *   * 422 / VALIDATION_ERROR → form-level message; we also do
 *                    client-side guards on length/match below.
 *   * Anything else / 5xx → generic "try again in a moment".
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { PRIVACY_URL, TERMS_URL } from "@/lib/links";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useSignup } from "@/lib/api/hooks";
import { Turnstile, turnstileConfigured } from "@/components/turnstile";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  isPasswordValid,
} from "@/lib/password-policy";

export default function SignupPage() {
  const router = useRouter();
  const signup = useSignup();

  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<React.ReactNode | null>(null);
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = React.useState(0);

  // Cheap client-side guards so the user gets immediate feedback
  // instead of a server roundtrip. The server still enforces these
  // independently — never trust the client for security.
  const passwordWeak = password.length > 0 && !isPasswordValid(password);
  const passwordMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const formInvalid =
    !displayName.trim() ||
    !email ||
    !password ||
    !confirmPassword ||
    passwordWeak ||
    passwordMismatch ||
    (turnstileConfigured && !captchaToken);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (signup.isPending) return;
    setErrorMsg(null);

    if (passwordMismatch) {
      setErrorMsg("Passwords don't match.");
      return;
    }
    if (!isPasswordValid(password)) {
      setErrorMsg("Please meet all the password requirements.");
      return;
    }

    try {
      await signup.mutateAsync({
        email,
        password,
        display_name: displayName.trim(),
        turnstile_token: captchaToken ?? undefined,
      });
      // Server returns redirect_path="/" for OWNER; route home and let
      // AppShell do the rest. The session cookie was just set on the
      // response, so the next render reads the new auth state.
      router.push("/");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't create your account",
        overrides: {
          // Deep-link to /login so a returning user with an existing
          // account doesn't have to figure out their next step.
          EMAIL_TAKEN: {
            title: "",
            description:
              "An account with that email already exists. Sign in instead.",
          },
        },
      });

      // For EMAIL_TAKEN specifically, render a clickable link inline.
      if (err instanceof ApiError && err.code === "EMAIL_TAKEN") {
        setErrorMsg(
          <span>
            An account with that email already exists.{" "}
            <Link
              href="/login"
              className="font-medium underline-offset-4 hover:underline"
            >
              Sign in instead
            </Link>
            .
          </span>,
        );
        setCaptchaToken(null);
        setCaptchaReset((n) => n + 1);
        return;
      }

      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
      setCaptchaToken(null);
      setCaptchaReset((n) => n + 1);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm"
      >
        <div className="space-y-3">
          {/* Logo mark — emerald rounded square + white check, matching the
              portal header and the consumer/brand sites' BrandMark. */}
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
          >
            <svg
              width="20"
              height="20"
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
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Create your owner account
            </h1>
            <p className="text-sm text-muted-foreground">
              Get your restaurant on the record — verified and searchable on
              Trust Halal.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="signup-name">Your name</Label>
            <Input
              id="signup-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoFocus
              autoComplete="name"
              maxLength={120}
              disabled={signup.isPending}
            />
            <p className="text-xs text-muted-foreground">
              How Trust Halal staff will see you when reviewing your claim.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={signup.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              disabled={signup.isPending}
              aria-invalid={passwordWeak}
            />
            <ul className="space-y-0.5 text-xs">
              {PASSWORD_RULES.map((rule) => {
                const met = rule.ok(password);
                return (
                  <li
                    key={rule.label}
                    className={
                      met
                        ? "text-emerald-600"
                        : password.length > 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {met ? "✓" : "•"} {rule.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="signup-confirm">Confirm password</Label>
            <Input
              id="signup-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              disabled={signup.isPending}
              aria-invalid={passwordMismatch}
            />
            {passwordMismatch && (
              <p className="text-xs text-destructive">
                Passwords don&apos;t match.
              </p>
            )}
          </div>

          {errorMsg && (
            <p
              className="text-sm text-destructive"
              role="alert"
              aria-live="polite"
            >
              {errorMsg}
            </p>
          )}

          {/* Live only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (prod). */}
          {/* Bot challenge — nothing in dev, gates the button in prod. */}
          <Turnstile onVerify={setCaptchaToken} resetSignal={captchaReset} />

        {/* Guideline 1.2 requires users of an app hosting user-generated
            content to agree to terms that state there is no tolerance for
            objectionable content or abusive users. This line is where that
            agreement happens; the clause itself is the first section of the
            terms. Placed above the button, so it is read before the action
            rather than after it. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            By creating an account you agree to our{" "}
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Privacy Policy
            </a>
            .
          </p>

          <Button
            type="submit"
            className="w-full"
            disabled={signup.isPending || formInvalid}
          >
            {signup.isPending ? "Creating account…" : "Create account"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
