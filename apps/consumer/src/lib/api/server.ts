/**
 * Minimal server-side fetch helper for public API endpoints.
 *
 * Used by routes that run on the Next.js server (`generateMetadata`,
 * `app/sitemap.ts`, `app/robots.ts`) — they can't import the
 * browser-only `apiFetch` because it sends `credentials: "include"`
 * and tags Sentry breadcrumbs from the window scope. Anonymous reads
 * over plain HTTPS are all we need here.
 *
 * Returns `null` on any non-2xx response or thrown error so callers
 * can degrade gracefully (a missing place metadata fetch should
 * still let the page render — the client hook will fetch and show a
 * proper error state on hydration).
 */

import { config } from "@/lib/config";

type ServerFetchOptions = {
  /** Optional Next.js fetch revalidation interval in seconds. */
  revalidate?: number;
};

export async function serverFetch<T>(
  path: string,
  { revalidate = 60 }: ServerFetchOptions = {},
): Promise<T | null> {
  try {
    const url = `${config.apiBaseUrl}${
      path.startsWith("/") ? path : `/${path}`
    }`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
