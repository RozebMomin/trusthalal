"use client";

/**
 * Consumer site login.
 *
 * Identical auth surface to the admin panel and owner portal —
 * same /auth/login endpoint, same single-error-code posture (no
 * user enumeration).
 *
 * ``?next=`` support: surfaces like the place detail page link here
 * with ``/login?next=/places/{id}`` so signing in drops the user
 * back where they were (to save a place, file a dispute) instead of
 * stranding them on the home page. Only same-site paths are honored
 * — anything that isn't a single-slash-rooted path falls back to
 * "/" so the param can't be abused as an open redirect.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { friendlyApiError } from "@/lib/api/friendly-errors";
import { useLogin } from "@/lib/api/hooks";
import { syncLocalToServerOnLogin } from "@/lib/api/preferences";
import { BRAND_NAME } from "@/lib/branding";
import { safeNextPath } from "@/lib/utils";

/**
 * `useSearchParams` needs a Suspense boundary above it during the
 * production prerender pass — same pattern as the home page.
 */
export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginPageInner />
    </React.Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();

  const nextPath = safeNextPath(searchParams?.get("next") ?? null);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (login.isPending) return;
    setErrorMsg(null);

    try {
      await login.mutateAsync({ email, password });
      // Best-effort: push any locally-saved preferences to the
      // server so the user's defaults follow them across devices.
      // Server failures here don't block the redirect — the local
      // copy stays so they can retry from /preferences.
      await syncLocalToServerOnLogin();
      router.push(nextPath);
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Brand escape hatch — the auth pages render without the app
          chrome, so without this the only way "home" is the browser
          back button. */}
      <Link
        href="/"
        className="mb-6 text-lg font-semibold tracking-tight transition hover:opacity-80"
      >
        {BRAND_NAME}
      </Link>
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
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={login.isPending}
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
            href={
              nextPath === "/"
                ? "/signup"
                : `/signup?next=${encodeURIComponent(nextPath)}`
            }
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
