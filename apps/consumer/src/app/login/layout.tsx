import type { Metadata } from "next";

/**
 * Route-segment layout whose only job is the per-route <title>.
 * The page itself is a client component ("use client") and can't
 * export metadata directly.
 */
export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
