"use client";

/**
 * Set-password landing page.
 *
 * URL shape: ``/set-password?token=<opaque>``
 *
 * Flow:
 *   1. On mount, read ``token`` from the query string.
 *   2. Call GET /auth/invite/{token} to look up the invited user's
 *      email. If that fails (invalid, expired, consumed), show a
 *      dead-end error state with a pointer back to login.
 *   3. Let the user enter + confirm a password (min 8 chars, matched).
 *   4. On submit, POST /auth/set-password. The server burns the
 *      token, sets the password hash, and auto-signs them in by
 *      setting the session cookie. We then honor the returned
 *      ``redirect_path`` (ADMIN → /places, VERIFIER → /claims, etc).
 *
 * Auth posture: this page is in ``PUBLIC_PATHS`` in app-shell.tsx,
 * so it renders without the sidebar and without the "you're not
 * signed in, go to /login" redirect. The page's security comes from
 * the single-use token, not from being behind the auth guard.
 */

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useInviteInfo, useSetPassword } from "@/lib/api/hooks";

// Matches the server-side Pydantic ``min_length=8`` check; kept in
// sync so the UI can reject short passwords without a round-trip.
const MIN_PASSWORD_LENGTH = 8;

// Next.js requires useSearchParams() to sit inside <Suspense>. The
// outer default export wraps the interactive component.
export default function SetPasswordPage() {
  return (
    <React.Suspense fallback={<CenteredMessage>Loading…</CenteredMessage>}>
      <SetPasswordInner />
    </React.Suspense>
  );
}

function SetPasswordInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? undefined;

  const inviteInfo = useInviteInfo(token);
  const setPassword = useSetPassword();

  const [password, setPasswordValue] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // No token at all → don't bother calling the API; skip straight to
  // the bad-link state. Saves a network request and avoids the
  // React Query fallback flash.
  if (!token) {
    return <BadLinkState reason="Missing token in the URL." />;
  }

  if (inviteInfo.isLoading) {
    return <CenteredMessage>Checking your invite…</CenteredMessage>;
  }

  if (inviteInfo.error) {
    // All the "why" cases collapse to a single BadLinkState on purpose
    // — the server deliberately doesn't distinguish invalid / expired
    // / consumed tokens, and the UI shouldn't invent that info either.
    const err = inviteInfo.error;
    const reason =
      err instanceof ApiError && err.status === 400
        ? "This invite link is invalid, expired, or already used."
        : "Couldn't verify this invite link. Try again, or ask an admin for a new one.";
    return <BadLinkState reason={reason} />;
  }

  if (!inviteInfo.data) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  const invitee = inviteInfo.data;
  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const canSubmit =
    !setPassword.isPending &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirm;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !token) return;
    setErrorMsg(null);

    try {
      const result = await setPassword.mutateAsync({ token, password });
      // Auto-login done server-side; land the user at their role's
      // home page.
      router.push(result.redirect_path);
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't set your password",
        overrides: {
          // If the token was already burned between prefetch and
          // submit (race, or the user backed out and retried), tell
          // them clearly instead of leaving a generic error in the
          // toast.
          INVITE_INVALID: {
            title: "Invite link no longer valid",
            description:
              "This link was already used or has expired. Ask an admin to send you a fresh one.",
          },
          VALIDATION_ERROR: {
            title: "Password rejected",
            description: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
          },
        },
      });
      setErrorMsg(description);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Set your password
          </h1>
          <p className="text-sm text-muted-foreground">
            Welcome{invitee.display_name ? `, ${invitee.display_name}` : ""}.
            You&apos;re setting a password for{" "}
            <span className="font-medium text-foreground">
              {invitee.email}
            </span>
            . After this, you&apos;ll be signed in automatically.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="set-password">New password</Label>
            <Input
              id="set-password"
              type="password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              required
              autoFocus
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              disabled={setPassword.isPending}
              aria-describedby={tooShort ? "set-password-hint" : undefined}
            />
            {tooShort && (
              <p
                id="set-password-hint"
                className="text-xs text-muted-foreground"
              >
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="set-password-confirm">Confirm password</Label>
            <Input
              id="set-password-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              disabled={setPassword.isPending}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "set-password-confirm-error" : undefined}
            />
            {mismatch && (
              <p
                id="set-password-confirm-error"
                className="text-sm text-destructive"
                role="alert"
              >
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

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {setPassword.isPending ? "Setting password…" : "Set password and sign in"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Need help? Ask the admin who sent you this link.
        </p>
      </form>
    </div>
  );
}

function BadLinkState({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-md border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Invite link can&apos;t be used
        </h1>
        <p className="text-sm text-muted-foreground">{reason}</p>
        <p className="text-sm text-muted-foreground">
          Ask an admin to send you a fresh set-password link.
        </p>
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to sign in →
        </Link>
      </div>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
