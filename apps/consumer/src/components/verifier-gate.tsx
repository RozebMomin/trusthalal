"use client";

/**
 * VerifierGate — wraps any /verifier/* route with the auth + role
 * checks it needs to render safely.
 *
 * Four states:
 *   1. /me loading           → spinner
 *   2. Not signed in         → redirect to /login?next=/verifier/…
 *   3. Signed in, wrong role → friendly "not a verifier yet" page with
 *                              CTA to /become-a-verifier
 *   4. Signed in as VERIFIER + ACTIVE profile → render children
 *
 * The role check is a soft guard — the server still enforces the same
 * rules on every API call — so a stale-cache or race can't unlock a
 * screen a user shouldn't see for more than a paint.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser, useVerifierProfile } from "@/lib/api/hooks";

export function VerifierGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const { data: profile, isLoading: profileLoading } = useVerifierProfile();

  // Not signed in — bounce to login. Preserve the destination so we
  // land back here on the way through.
  React.useEffect(() => {
    if (!meLoading && me === null) {
      const path =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "/verifier";
      router.replace(`/login?next=${encodeURIComponent(path)}`);
    }
  }, [me, meLoading, router]);

  if (meLoading || (me && profileLoading)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!me) return null; // redirect is pending

  // Signed in but not a verifier — dead end here, offer the apply
  // link instead.
  if (me.role !== "VERIFIER" || !profile) {
    return <NotAVerifierPage />;
  }

  // Verifier but profile is SUSPENDED / REVOKED — read-only info.
  if (profile.status !== "ACTIVE") {
    return <SuspendedProfilePage status={profile.status} />;
  }

  return <>{children}</>;
}

function NotAVerifierPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center">
      <h1 className="mb-3 font-serif text-3xl font-semibold">
        You&apos;re not a verifier yet
      </h1>
      <p className="mb-6 text-muted-foreground">
        The verifier portal is for community members who&apos;ve been
        approved to file visit reports. If you&apos;d like to become
        one, we&apos;d love to hear from you.
      </p>
      <div className="flex justify-center gap-3">
        <Button asChild>
          <Link href="/become-a-verifier">Apply to be a verifier</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to the directory</Link>
        </Button>
      </div>
    </main>
  );
}

function SuspendedProfilePage({
  status,
}: {
  status: "SUSPENDED" | "REVOKED";
}) {
  const isRevoked = status === "REVOKED";
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center">
      <h1 className="mb-3 font-serif text-3xl font-semibold">
        {isRevoked ? "Verifier access revoked" : "Verifier access paused"}
      </h1>
      <p className="mb-6 text-muted-foreground">
        {isRevoked
          ? "Your verifier account has been revoked. Past visits remain in the audit trail, but you can't submit new ones."
          : "Your verifier account is temporarily paused while admin reviews a concern. You can still see your dashboard, but you can't submit new visits right now."}
      </p>
      <p className="text-sm text-muted-foreground">
        Questions? Reach out at{" "}
        <a
          href="mailto:verifiers@trusthalal.org"
          className="font-medium text-foreground hover:underline"
        >
          verifiers@trusthalal.org
        </a>
        .
      </p>
    </main>
  );
}
