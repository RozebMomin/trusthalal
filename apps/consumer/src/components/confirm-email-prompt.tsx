"use client";

/**
 * "Confirm your email to do that" — with a button that actually sends one.
 *
 * ## Why this component exists
 *
 * Email verification shipped after the platform had users. Everyone who
 * signed up before it existed has `email_verified_at = NULL` and has never
 * been sent a confirmation link — nothing backfilled them, and nothing
 * triggers a send on login or when the gate refuses.
 *
 * The first version of this prompt said "check your inbox for the
 * confirmation link", which for those accounts pointed at an email that
 * doesn't exist. The only resend button in the product lived on
 * /verify-email — the page you land on *from a link* — so the people who
 * most needed it were the ones who couldn't reach it.
 *
 * So the prompt sends. Deliberately user-initiated rather than automatic on
 * login: most sign-ins aren't review attempts, and mailing everyone on every
 * login to solve a problem they may not have is how a product teaches people
 * to filter its email.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useResendVerification } from "@/lib/api/hooks";

export function ConfirmEmailPrompt({
  action = "write a review",
  className,
}: {
  /** What they were trying to do, so the sentence reads naturally. */
  action?: string;
  className?: string;
}) {
  const resend = useResendVerification();

  if (resend.isSuccess) {
    return (
      <p
        className={
          className ??
          "rounded-md bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-900"
        }
      >
        {resend.data?.sent
          ? `Sent — check ${resend.data.email} and click the link. Then you're all set.`
          : "Your email is already confirmed. Refresh the page and try again."}
      </p>
    );
  }

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3"
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Confirm your email address to {action}. We ask because a review
        carries a real restaurant&rsquo;s reputation.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={resend.isPending}
        onClick={() => resend.mutate({ audience: "consumer" })}
      >
        {resend.isPending ? "Sending…" : "Send me the link"}
      </Button>
      {resend.isError && (
        <p className="w-full text-xs text-destructive" role="alert">
          Couldn&rsquo;t send that. Try again in a moment.
        </p>
      )}
    </div>
  );
}
