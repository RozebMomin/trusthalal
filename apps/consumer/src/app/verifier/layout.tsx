/**
 * Layout for every /verifier/* route.
 *
 * The gate wraps children with auth + role checks (see
 * VerifierGate). Everything inside gets to assume the user is
 * signed in, has role=VERIFIER, and has an ACTIVE profile.
 */
import { VerifierGate } from "@/components/verifier-gate";

export default function VerifierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <VerifierGate>{children}</VerifierGate>;
}
