"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { PostHogProvider } from "./posthog-provider";

/**
 * Client-side providers that wrap every route.
 *
 * QueryClient is created once per browser session via useState so
 * React strict mode's double-invoke doesn't give us two stores.
 * Same shape used by apps/admin and apps/owner — keeping the three
 * stacks consistent makes "why is this query stale?" debugging a
 * one-app problem instead of a three-app problem.
 *
 * Nesting order matters: PostHogProvider sits INSIDE the
 * QueryClientProvider so its ``PostHogIdentify`` watcher can read
 * ``useCurrentUser()`` (a TanStack query) and tie events to the
 * signed-in user without re-resolving auth on its own.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PostHogProvider>
        {children}
        {process.env.NODE_ENV !== "production" && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </PostHogProvider>
    </QueryClientProvider>
  );
}
