"use client";

/**
 * Consumer site login.
 *
 * Identical auth surface to the admin panel and owner portal —
 * same /auth/login endpoint, same single-error-code posture (no
 * user enumeration). After a successful login, the API returns the
 * user's role and a redirect_path; the consumer site ignores the
 * path and routes home. The AppShell handles the rest (anonymous
 * vs signed-in chrome, or a "wrong audience" pointer for staff
 * accounts that landed here).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useLogin } from "@/lib/api/hooks";

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (login.isPending) return;
    setErrorMsg(null);

    try {
      await login.mutateAsync({ email, password });
      router.push("/");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't sign in",
        overrides: {
          // Server collapses every auth failure into INVALID_CREDENTIALS
          // to avoid revealing which of email / password / inactive
          // tripped. UI mirrors that.
          INVALID_CREDENTIALS: {
            title: "",
            description:
              "Invalid email or password. Check your input or contact Trust Halal if you've lost access.",
          },
        },
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on our end. Please try again in a moment."
          : description,
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 rounded-md border bg-card p-8 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">Trust Halal</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              disabled={login.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={login.isPending}
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
            disabled={login.isPending || !email || !password}
          >
            {login.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          New here?{" "}
          <Link
            href="/signup"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>{" "}
          to save preferences and file disputes.
        </p>
      </form>
    </div>
  );
}
