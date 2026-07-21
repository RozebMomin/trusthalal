"use client";

/**
 * The acknowledgement prompt for accounts that predate recorded acceptance.
 *
 * Terms shipped after the product did, so everyone who signed up before that
 * — including the people whose reviews and photos the content licence is
 * written to cover — agreed to nothing. The signup notice can't reach them;
 * they've already signed up. This is the only surface that can.
 *
 * It blocks rather than nags: a dismissible banner gets ignored, which would
 * leave the record exactly as thin as it was and make building this
 * pointless. But it is not a trap — sign out is offered, because the honest
 * alternative to accepting terms is to stop using the account, and browsing
 * this site never required one.
 */

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAcceptTerms, useCurrentUser, useLogout } from "@/lib/api/hooks";
import { PRIVACY_URL, TERMS_URL } from "@/lib/branding";

export function TermsGate() {
  const { data: me } = useCurrentUser();
  const accept = useAcceptTerms();
  const logout = useLogout();
  const [failed, setFailed] = React.useState(false);

  const open = Boolean(me?.terms_acceptance_required);

  return (
    <Dialog
      open={open}
      // No close path. onOpenChange is deliberately a no-op so Escape and
      // the overlay don't dismiss what the design says is not dismissible.
      onOpenChange={() => {}}
    >
      <DialogContent
        className="max-w-lg"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>A quick thing before you carry on</DialogTitle>
          <DialogDescription>
            We&rsquo;ve published terms of service. Your account was created
            before we had them, so we need you to have a look and agree.
          </DialogDescription>
        </DialogHeader>

        {/* Named plainly rather than left to be discovered in the document.
            It's the clause most likely to matter to whoever is reading
            this. */}
        <div className="rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
          <p className="font-semibold">The short version</p>
          <p className="mt-1 text-muted-foreground">
            There&rsquo;s no tolerance for objectionable content or abusive
            users. Your reviews and photos stay yours — you give us permission
            to show them, and you can delete them whenever you like.
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
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
          <p className="text-sm text-destructive">
            Couldn&rsquo;t save that just now — check your connection and try
            again. Nothing else has changed.
          </p>
        )}

        <div className="mt-1 flex flex-col gap-2">
          <Button
            onClick={() => {
              setFailed(false);
              accept.mutate(undefined, { onError: () => setFailed(true) });
            }}
            disabled={accept.isPending}
          >
            {accept.isPending ? "Saving…" : "I agree"}
          </Button>
          {/* The way out. Declining means not using the account, not being
              stuck in a dialog. */}
          <Button
            variant="ghost"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="text-muted-foreground"
          >
            {logout.isPending ? "Signing out…" : "Sign out instead"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
