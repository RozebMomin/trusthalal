/**
 * Tiny build-version indicator.
 *
 * Two pieces of info, joined with a middle dot:
 *
 *   1. Manual semver from package.json — bump this in PRs that ship
 *      something meaningful. Tells users (and us in support) which
 *      release of the panel they're on.
 *   2. Short git SHA from NEXT_PUBLIC_APP_RELEASE_SHA — auto-populated
 *      at build time on Vercel via $VERCEL_GIT_COMMIT_SHA. Tells us
 *      "did my latest commit actually make it to prod?" at a glance,
 *      including across hot-fixes that didn't bump the semver.
 *
 * Display: ``v0.1.0 · abc1234``  (sha is hover-tooltipped to full)
 *
 * If the SHA env var isn't set (e.g. local dev), we omit it — just
 * ``v0.1.0`` looks intentional rather than half-broken.
 */
import packageJson from "../../package.json";

/**
 * A SHA looks like 40 hex chars. Anything else is almost certainly
 * a misconfigured env var — most commonly the literal string
 * ``$VERCEL_GIT_COMMIT_SHA`` saved as the value because Vercel doesn't
 * do shell-style $VAR expansion. Drop those rather than rendering a
 * confusing "v0.1.0 · $VERCEL" tag.
 */
function looksLikeRealSha(s: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(s);
}

export function VersionTag({ className }: { className?: string }) {
  const version = packageJson.version;
  const raw = (process.env.NEXT_PUBLIC_APP_RELEASE_SHA || "").trim();
  const sha = looksLikeRealSha(raw) ? raw : "";
  const shortSha = sha ? sha.slice(0, 7) : null;

  const display = shortSha ? `v${version} · ${shortSha}` : `v${version}`;
  const tooltip = shortSha
    ? `admin v${version} (${sha})`
    : `admin v${version}`;

  return (
    <span
      className={[
        "select-none font-mono text-[10px] text-muted-foreground/70",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={tooltip}
    >
      {display}
    </span>
  );
}
