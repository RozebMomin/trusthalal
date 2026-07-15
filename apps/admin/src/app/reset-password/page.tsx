"use client";

/**
 * Admin panel "reset password" — set a new password from an email link.
 *
 * Reads ?token=, prefetches whose account it is (GET /auth/reset/{token}),
 * and on submit sets the new password. On success the account is signed
 * out everywhere and we route to /login (no auto-login). Invalid / expired
 * / used tokens render a dead-end with a link back to request a fresh one.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useResetInfo, useResetPassword } from "@/lib/api/hooks";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  isPasswordValid,
} from "@/lib/password-policy";

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPasswordInner />
    </React.Suspense>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? null;

  const info = useResetInfo(token);
  const reset = useResetPassword();

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Invalid link: no token, or the prefetch rejected it.
  if (!token || info.isError) {
    return (
      <AuthShell>
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
          <p className="text-sm text-muted-foreground">
            This password-reset link is invalid, expired, or already used.
            Request a fresh one and try again.
          </p>
          <Link
            href="/forgot-password"
            className="inline-block pt-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (info.isLoading) {
    return (
      <AuthShell>
        <p className="text-sm text-muted-foreground">Checking your link…</p>
      </AuthShell>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reset.isPending) return;
    setErrorMsg(null);
    if (password !== confirm) {
      setErrorMsg("Those passwords don't match.");
      return;
    }
    if (!isPasswordValid(password)) {
      setErrorMsg("Please meet all the password requirements.");
      return;
    }
    try {
      await reset.mutateAsync({ token: token as string, password });
      router.push("/login?reset=1");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't reset your password",
        overrides: {
          RESET_INVALID: {
            title: "",
            description:
              "This reset link is invalid or expired. Request a new one.",
          },
        },
      });
      setErrorMsg(description);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Set a new password
          </h1>
          {info.data?.email && (
            <p className="text-sm text-muted-foreground">
              for{" "}
              <span className="font-medium text-foreground">
                {info.data.email}
              </span>
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-password">New password</Label>
            <div className="relative">
              <Input
                id="reset-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoFocus
                autoComplete="new-password"
                disabled={reset.isPending}
                className="pr-16"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
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
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <Input
              id="reset-confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              disabled={reset.isPending}
            />
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
            disabled={reset.isPending || !password || !confirm}
          >
            {reset.isPending ? "Saving…" : "Set new password"}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
