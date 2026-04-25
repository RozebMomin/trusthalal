"use client";

/**
 * Owner portal login.
 *
 * Identical auth surface to the admin panel's /login — same
 * /auth/login endpoint, same single-error-code posture (no user
 * enumeration). After a successful login, the API returns the
 * user's role and a redirect_path; OWNERs land at /, everyone else
 * gets the NotForYouPane via AppShell so they're not stranded with a
 * stale session.
 */

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
      // The API returns redirect_path scoped per role. For owners
      // that's "/owner" today, but the portal lives at the root of
      // its own subdomain — so we ignore the server's path and just
      // route home. AppShell takes over and either shows the portal
      // (OWNER) or NotForYouPane (anyone else).
      router.push("/");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't sign in",
        overrides: {
          // Server collapses every auth failure into INVALID_CREDENTIALS
          // to avoid revealing which of email / password / inactive
          // tripped. We mirror that on the UI side.
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
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in
          </h1>
          <p className="text-sm text-muted-foreground">
            Trust Halal owner portal
          </p>
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
          <span className="text-foreground">Trust Halal staff</span> issues
          owner accounts; you should have received a set-password link
          via email or directly from your contact.
        </p>
      </form>
    </div>
  );
}
