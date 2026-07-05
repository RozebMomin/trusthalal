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
