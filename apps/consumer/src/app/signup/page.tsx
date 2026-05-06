"use client";

/**
 * Consumer site signup.
 *
 * Mirrors the owner-portal signup form but explicitly hard-codes
 * ``role=CONSUMER`` (the useSignup hook does it; the form just
 * collects email + password + display name). The CONSUMER role
 * unlocks preferences and the file-a-dispute action; without it,
 * those features stay behind a Sign in / Sign up gate.
 *
 * Failure modes:
 *   * EMAIL_TAKEN  → deep-link to /login.
 *   * VALIDATION_ERROR → inline form-level message.
 *   * 5xx → generic "try again in a moment".
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useSignup } from "@/lib/api/hooks";
import { syncLocalToServerOnLogin } from "@/lib/api/preferences";

// Mirrors the server's SignupRequest min_length=8.
const PASSWORD_MIN_LENGTH = 8;

export default function SignupPage() {
  const router = useRouter();
  const signup = useSignup();

  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<React.ReactNode | null>(null);

  // Cheap client-side guards so the user gets immediate feedback
  // instead of a server roundtrip. The server still enforces these
  // independently — never trust the client for security.
  const passwordTooShort =
    password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const passwordMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const formInvalid =
    !displayName.trim() ||
    !email ||
    !password ||
    !confirmPassword ||
    passwordTooShort ||
    passwordMismatch;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (signup.isPending) return;
    setErrorMsg(null);

    if (passwordMismatch) {
      setErrorMsg("Passwords don't match.");
      return;
    }
    if (passwordTooShort) {
      setErrorMsg(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      );
      return;
    }

    try {
      await signup.mutateAsync({
        email,
        password,
        display_name: displayName.trim(),
      });
      // Migrate any anonymous-saved preferences to the new account
      // before redirecting. Best-effort — a failure here doesn't
      // block the signup flow; the local copy stays so the user
      // can retry from /preferences.
      await syncLocalToServerOnLogin();
      // Server auto-logs the new user in (sets the session cookie on
      // the response). Route home; AppShell reads the new auth state
      // on the next render.
      router.push("/");
    } catch (err) {
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
        return;
      }

      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't create your account",
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="text-sm text-muted-foreground">
            Save preferences. File disputes. See verified halal places.
          </p>
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
              Shown on disputes you file so admin staff and the
              restaurant owner know who&apos;s reporting.
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
              aria-invalid={passwordTooShort}
            />
            <p className="text-xs text-muted-foreground">
              At least {PASSWORD_MIN_LENGTH} characters.
            </p>
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
