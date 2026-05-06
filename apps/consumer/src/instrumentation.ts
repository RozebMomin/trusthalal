/**
 * Next.js 14 instrumentation hook for the consumer site.
 *
 * Mirror of apps/admin and apps/owner — boots the right Sentry
 * runtime config based on Node-vs-Edge. Actual Sentry.init() lives
 * in sentry.{server,edge}.config.ts at the project root.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
