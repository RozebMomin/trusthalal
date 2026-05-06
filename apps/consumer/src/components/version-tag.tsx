/**
 * Tiny build-version indicator for the owner portal.
 *
 * Same shape as apps/admin's: manual semver from package.json
 * (you bump it on meaningful releases) plus the short git SHA from
 * NEXT_PUBLIC_APP_RELEASE_SHA (auto-populated by Vercel build via
 * $VERCEL_GIT_COMMIT_SHA). Display is ``v0.1.0 · abc1234`` with the
 * full SHA on hover.
 *
 * Owner portal is customer-facing, so the styling is intentionally
 * understated — small, muted, sits next to the sign-out control.
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
    ? `owner v${version} (${sha})`
    : `owner v${version}`;

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
