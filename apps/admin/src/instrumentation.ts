/**
 * Next.js 14 instrumentation hook.
 *
 * Called once per worker before any request is served. We use it to
 * load the right Sentry runtime config based on which Node-vs-Edge
 * environment we're booting in. The actual Sentry.init() lives in
 * sentry.{server,edge}.config.ts at the project root — those files
 * are picked up by @sentry/nextjs's webpack plugin automatically.
 *
 * Without this hook, server errors from route handlers and server
 * components don't reach Sentry; with it, they do.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
