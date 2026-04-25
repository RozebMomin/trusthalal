/**
 * Turn a caught error from an admin mutation into user-facing copy.
 *
 * Every admin dialog ends up with the same shape of catch block: `toast`
 * a destructive variant whose title describes the action that failed
 * and whose description tells the user what went wrong. Doing that by
 * hand everywhere meant each dialog had to re-decide which ApiError
 * codes to branch on and what to say — fine for two dialogs, noise for
 * a dozen.
 *
 * `friendlyApiError` centralizes that decision. It ships with copy for
 * the codes every caller can hit (auth + validation + generic), and
 * each callsite can supply domain-specific overrides for codes it
 * uniquely cares about (e.g. GOOGLE_PLACE_NOT_FOUND on the link flow,
 * CLAIM_EXPIRED on the verify flow).
 *
 * Typical use:
 *
 *     } catch (err) {
 *       const msg = friendlyApiError(err, {
 *         defaultTitle: "Couldn't add place",
 *         overrides: {
 *           GOOGLE_PLACE_NOT_FOUND: {
 *             title: "Place not found on Google",
 *             description: "Google no longer recognizes this place…",
 *           },
 *         },
 *       });
 *       toast({ ...msg, variant: "destructive" });
 *     }
 *
 * Why function-valued overrides are supported: some overrides want to
 * interpolate the server's raw ``err.message`` into a longer sentence
 * ("The server rejected the payload (X). This is likely a bug.") —
 * that's not expressible with a static `{title, description}` literal,
 * so the override value can also be a function of the `ApiError`.
 */

import { ApiError } from "./client";

export type FriendlyError = {
  title: string;
  description: string;
};

export type ErrorOverrides = Partial<
  Record<string, FriendlyError | ((err: ApiError) => FriendlyError)>
>;

// ---------------------------------------------------------------------------
// Base copy — codes every admin mutation can hit. Keep these CAREFUL and
// action-neutral: callers can always override for action-specific wording.
// ---------------------------------------------------------------------------
const BASE_COPY: Record<string, FriendlyError> = {
  UNAUTHORIZED: {
    title: "Sign-in required",
    description:
      "Your admin session is missing or invalid. Refresh the page and try again.",
  },
  FORBIDDEN: {
    title: "Admin access required",
    description:
      "Your account doesn't have admin privileges for this action. Ask another admin to reinstate access if this is a mistake.",
  },
  VALIDATION_ERROR: {
    title: "Request was rejected",
    description:
      "The server rejected this request. This is usually a panel/server contract drift — please report it.",
  },
  NOT_FOUND: {
    title: "Not found",
    description:
      "The resource you're working with no longer exists. It may have been deleted in another tab or by another admin.",
  },
  CONFLICT: {
    title: "Action conflicts with current state",
    description:
      "The current state prevents this change. Reload the page and try again.",
  },
  HTTP_ERROR: {
    title: "Request failed",
    description:
      "Something went wrong on the server. Please try again in a moment.",
  },
};

/**
 * Translate a caught error into a toast-ready {title, description}.
 *
 * Lookup order:
 *   1. ``opts.overrides[err.code]`` — per-callsite overrides (supports
 *      both static literals and functions of the ApiError).
 *   2. ``BASE_COPY[err.code]``       — universal codes.
 *   3. Fallback: ``{title: defaultTitle, description: err.message}`` —
 *      the server's humane message lands in the toast verbatim, so new
 *      backend codes degrade gracefully without a client release.
 *
 * Non-ApiError inputs (network timeouts, offline, CORS) → generic
 * network-issue copy using ``defaultTitle`` as the heading.
 */
export function friendlyApiError(
  err: unknown,
  opts: {
    /**
     * Title used for the fallback case and for non-ApiError inputs. If
     * omitted, "Something went wrong" is used — typically you want
     * something action-specific like "Couldn't add place".
     */
    defaultTitle?: string;
    /**
     * Per-code override map. Values can be a literal ``FriendlyError``
     * or a function that receives the ``ApiError`` (useful when the
     * copy needs to interpolate ``err.message`` or ``err.detail``).
     */
    overrides?: ErrorOverrides;
  } = {},
): FriendlyError {
  const defaultTitle = opts.defaultTitle ?? "Something went wrong";

  if (!(err instanceof ApiError)) {
    return {
      title: defaultTitle,
      description:
        "Network error. Check that trusthalal-api is reachable and try again.",
    };
  }

  const override = opts.overrides?.[err.code];
  if (override) {
    return typeof override === "function" ? override(err) : override;
  }

  const base = BASE_COPY[err.code];
  if (base) return base;

  return { title: defaultTitle, description: err.message };
}

// ---------------------------------------------------------------------------
// Field-level validation errors
//
// When the server returns VALIDATION_ERROR, ``err.detail`` carries
// Pydantic's ``errors()`` output — an array of entries shaped like:
//
//     {
//       "type": "less_than_equal",
//       "loc":  ["body", "lat"],
//       "msg":  "Input should be less than or equal to 90",
//       "input": 91, "ctx": { "le": 90.0 }
//     }
//
// The ``loc`` tuple tells us exactly which field the server complained
// about. Forms can use ``fieldErrorsFromApiError`` to turn that list
// into a field-name → message map and render each message under its
// corresponding input.
// ---------------------------------------------------------------------------

type PydanticErrorEntry = {
  loc: (string | number)[];
  msg: string;
  type?: string;
};

// Leading ``loc`` segments that identify the *source* of the input
// rather than the field itself. We strip these so callers can key on
// field names as they appear in their form state.
const REQUEST_SOURCE_SEGMENTS = new Set<string>([
  "body",
  "query",
  "path",
  "header",
  "cookie",
]);

/**
 * Extract a field-name → first-error-message map from an ApiError
 * whose code is VALIDATION_ERROR.
 *
 * Returns an empty object for any other error shape (non-ApiError,
 * non-validation code, or detail that isn't a list) so callers can
 * blanket-assign without defensive checks.
 *
 * Nesting: ``loc: ["body", "user", "name"]`` becomes ``"user.name"``.
 * List indices stringify in place: ``loc: ["body", "tags", 0]`` →
 * ``"tags.0"``.
 *
 * First error per field wins — keeps the UI stable when a field has
 * multiple validators firing at once. The full detail list is still
 * available on ``err.detail`` if a caller wants to dig deeper.
 */
export function fieldErrorsFromApiError(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  if (err.code !== "VALIDATION_ERROR") return {};
  if (!Array.isArray(err.detail)) return {};

  const out: Record<string, string> = {};
  for (const raw of err.detail as unknown[]) {
    if (raw === null || typeof raw !== "object") continue;
    const entry = raw as Partial<PydanticErrorEntry>;
    if (!Array.isArray(entry.loc) || typeof entry.msg !== "string") continue;

    // Drop the leading "body" / "query" / ... segment if present, so the
    // caller can index on field names directly.
    const segments = entry.loc.slice();
    if (
      segments.length > 0 &&
      typeof segments[0] === "string" &&
      REQUEST_SOURCE_SEGMENTS.has(segments[0])
    ) {
      segments.shift();
    }
    if (segments.length === 0) continue;

    const fieldKey = segments.map(String).join(".");
    if (!(fieldKey in out)) {
      out[fieldKey] = entry.msg;
    }
  }
  return out;
}
