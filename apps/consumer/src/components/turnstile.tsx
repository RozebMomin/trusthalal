"use client";

/**
 * Cloudflare Turnstile widget for the signup form.
 *
 * Renders nothing and reports no token when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
 * unset — that's local dev, where the API's TURNSTILE_ENABLED is also off, so
 * signup works without a challenge. In production both are set and the API
 * refuses a signup whose token it can't verify.
 *
 * The token is single-use: Cloudflare invalidates it once siteverify has seen
 * it, and it also expires on its own after a few minutes. So the parent bumps
 * `resetSignal` after a failed submit to force a fresh widget + fresh token,
 * rather than resubmitting a spent one.
 */

import * as React from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      remove: (id: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed to load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** True when a site key is configured, i.e. the challenge is in play. Lets the
 *  form gate its submit button on a token in prod without deadlocking dev. */
export const turnstileConfigured = Boolean(SITE_KEY);

export function Turnstile({
  onVerify,
  resetSignal = 0,
}: {
  onVerify: (token: string | null) => void;
  resetSignal?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!SITE_KEY) return;
    let widgetId: string | null = null;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        ref.current.innerHTML = "";
        widgetId = window.turnstile.render(ref.current, {
          sitekey: SITE_KEY,
          theme: "auto",
          callback: (token) => onVerify(token),
          // A spent or timed-out token must not be resubmitted — clear it so
          // the form knows it needs a fresh challenge.
          "expired-callback": () => onVerify(null),
          "error-callback": () => onVerify(null),
        });
      })
      .catch(() => onVerify(null));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* widget already gone */
        }
      }
    };
    // resetSignal in deps: bumping it re-runs the effect → fresh widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="flex justify-center" />;
}
