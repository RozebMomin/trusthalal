"use client";

/**
 * Admin login page.
 *
 * Renders without the sidebar (AppShell skips the chrome on this
 * route). On success the server returns a ``redirect_path`` derived
 * from the user's role — admins go to /places, verifiers to /claims,
 * etc. We honor that path rather than hard-coding it so role routing
 * stays server-authoritative.
 *
 * Redirect-when-already-signed-in lives in AppShell so /login is the
 * "you are not authenticated" render and nothing else.
 */

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useLogin } from "@/lib/api/hooks";
import { homeFor } from "@/lib/auth/panel-access";

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
      const result = await login.mutateAsync({ email, password });
      // Home-less roles (OWNER until the dashboard exists, CONSUMER
      // always) get routed to a path AppShell can handle cleanly —
      // "/" renders inside the root layout so AppShell's
      // NoAccessPane catches it. The server still returns a
      // ``redirect_path`` but that path may not exist as a Next.js
      // route yet (e.g. /owner), which would flash a 404 before the
      // shell redirect kicks in.
      //
      // For roles with a real panel home, honor the server's
      // redirect verbatim — keeps role routing server-authoritative.
      const clientHome = homeFor(result.role);
      router.push(clientHome ? result.redirect_path : "/");
    } catch (err) {
      const { description } = friendlyApiError(err, {
        defaultTitle: "Couldn't sign in",
        overrides: {
          // Server emits a single generic code on every auth failure
          // (wrong password, nonexistent email, deactivated account,
          // missing hash). The inline message stays vague by design
          // — no user enumeration.
          INVALID_CREDENTIALS: {
            title: "",
            description:
              "Invalid email or password. Check your input or ask an admin to reset your access.",
          },
        },
      });
      setErrorMsg(
        err instanceof ApiError && err.status >= 500
          ? "Something went wrong on the server. Please try again."
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
          <p className="text-sm text-muted-foreground">
            trusthalal admin panel
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
          Don&apos;t have access?{" "}
          <span className="text-foreground">Ask an admin</span> to send you a
          set-password link.
        </p>
      </form>
    </div>
  );
}
