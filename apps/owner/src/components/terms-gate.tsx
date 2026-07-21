"use client";

/**
 * The acknowledgement prompt for owner accounts that predate recorded
 * acceptance.
 *
 * Same job as the consumer and mobile gates: terms shipped after the product
 * did, so every account created before that agreed to nothing, and the signup
 * notice can't reach people who have already signed up.
 *
 * Built as a plain fixed overlay rather than with Radix, because this app has
 * no dialog primitive and pulling one in for a single blocking panel would be
 * more surface than the panel. The trade is that focus is not trapped — worth
 * naming, though the panel covers the whole viewport and the only interactive
 * elements behind it are a nav bar.
 *
 * It blocks but does not trap: sign out is offered, because the honest
 * alternative to accepting is to stop using the account.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useAcceptTerms, useCurrentUser, useLogout } from "@/lib/api/hooks";
import { PRIVACY_URL, TERMS_URL } from "@/lib/links";

export function TermsGate() {
  const { data: me } = useCurrentUser();
  const accept = useAcceptTerms();
  const logout = useLogout();
  const [failed, setFailed] = React.useState(false);

  if (!me?.terms_acceptance_required) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="terms-gate-title" className="text-lg font-semibold">
          A quick thing before you carry on
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We&rsquo;ve published terms of service. Your account was created
          before we had them, so we need you to have a look and agree.
        </p>

        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
          <p className="font-semibold">The short version</p>
          <p className="mt-1 text-muted-foreground">
            There&rsquo;s no tolerance for objectionable content or abusive
            users. You can reply to any review of your restaurant and report
            one that breaks the rules — but a review can&rsquo;t be removed
            for being unflattering. What you tell us about your kitchen has to
            be accurate, because diners decide on it.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-primary underline underline-offset-2"
          >
            Read the terms →
          </a>
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-primary underline underline-offset-2"
          >
            Privacy →
          </a>
        </div>

        {failed && (
          <p className="mt-4 text-sm text-destructive">
            Couldn&rsquo;t save that just now — check your connection and try
            again. Nothing else has changed.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Button
            onClick={() => {
              setFailed(false);
              accept.mutate(undefined, { onError: () => setFailed(true) });
            }}
            disabled={accept.isPending}
          >
            {accept.isPending ? "Saving…" : "I agree"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="text-muted-foreground"
          >
            {logout.isPending ? "Signing out…" : "Sign out instead"}
          </Button>
        </div>
      </div>
    </div>
  );
}
