import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes with conditional logic.
 * Standard shadcn/ui helper.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Serialize an object for embedding inside a
 * ``<script type="application/ld+json">`` block.
 *
 * ``JSON.stringify`` alone is NOT safe here: it does not escape ``<``,
 * ``>`` or ``/``, so a stored value containing ``</script>`` (e.g. a
 * verifier bio or social link) would close the script element and
 * inject executable markup — a stored-XSS vector. We escape the HTML-
 * significant characters and the JS line-separators to their unicode
 * escapes, which JSON parsers still read as the original characters.
 */
export function jsonLdSafe(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/[\u2028]/g, "\\u2028")
    .replace(/[\u2029]/g, "\\u2029");
}

/**
 * Validate a ``?next=`` query param into a safe same-site path.
 * Rejects protocol-relative ("//evil.com") and absolute URLs so the
 * param can't be abused as an open redirect. Used by /login and
 * /signup to return the user to the page that sent them there.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
