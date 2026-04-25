"use client";

/**
 * Google Places Autocomplete input.
 *
 * Wraps the Maps JavaScript API's legacy Autocomplete widget in a controlled
 * React input. We chose the *legacy* `google.maps.places.Autocomplete` over
 * the newer `PlaceAutocompleteElement` web component because:
 *
 *   1. The legacy widget emits a plain DOM event (`place_changed`) on the
 *      input we own, so Tailwind/shadcn styling "just works" — no shadow DOM
 *      surprises. The New API's element is a web component whose styling is
 *      harder to override consistently.
 *   2. We only need the place_id string out of it; the server does the Place
 *      Details fetch. Both APIs return place_id equivalently here.
 *   3. The ``types: ["establishment"]`` + ``fields: ["place_id", "name",
 *      "formatted_address"]`` combination is cheaper to bill than letting
 *      the widget return the full place object.
 *
 * Loader strategy: the Maps JS loader is guaranteed singleton by a
 * module-level Promise. React StrictMode double-mounts components in dev,
 * and multiple instances of this component on the same page must not each
 * inject the <script> tag.
 */

import * as React from "react";

import { Input } from "@/components/ui/input";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * Fields the widget passes back from a picked prediction. These come from the
 * Autocomplete's own response (not a separate API call) so they're free —
 * Google already billed us for the Autocomplete session that produced them.
 *
 * `name` + `formatted_address` are surfaced separately (instead of being
 * pre-joined into a `description`) so callers can render a proper two-line
 * preview and not have to string-split something we already had structured.
 */
export type PickedPlace = {
  place_id: string;
  name: string | null;
  formatted_address: string | null;
};

type Props = {
  /** Fired when the user selects a prediction from the dropdown. */
  onPick: (picked: PickedPlace) => void;
  /** Optional callback fired whenever the input text changes (not a pick). */
  onTextChange?: (text: string) => void;
  /** Placeholder for the input. */
  placeholder?: string;
  /** Forwarded to the underlying Input. */
  className?: string;
  /** autoFocus for dialog ergonomics. */
  autoFocus?: boolean;
  /** Disable the input (e.g. while an ingest mutation is in flight). */
  disabled?: boolean;
  /** Optional id (for <Label htmlFor>). */
  id?: string;
};

// Country types accepted by the widget. Empty array = worldwide.
// Narrow to specific ISO-2 codes if regional scope tightens.
const COUNTRY_RESTRICTIONS: string[] = [];

// These are the only fields we need back from Autocomplete. Google bills
// Autocomplete per-session + per-field; keeping this list tight matters.
const AUTOCOMPLETE_FIELDS = ["place_id", "name", "formatted_address"] as const;

// ---------------------------------------------------------------------------
// Script loader (module-scoped so StrictMode + multiple mounts share one load)
// ---------------------------------------------------------------------------

type MapsWindow = Window & {
  google?: {
    maps?: {
      places?: {
        Autocomplete: new (
          input: HTMLInputElement,
          opts?: Record<string, unknown>,
        ) => GoogleAutocomplete;
      };
    };
  };
};

type GoogleAutocomplete = {
  addListener: (ev: string, cb: () => void) => { remove: () => void };
  getPlace: () => {
    place_id?: string;
    name?: string;
    formatted_address?: string;
  };
};

let loaderPromise: Promise<void> | null = null;

function loadMapsScript(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps loader called on the server."));
  }
  const win = window as MapsWindow;

  if (win.google?.maps?.places?.Autocomplete) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    // Check for an already-injected tag (hot reload, parallel mount)
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-trusthalal-gmaps]",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Maps script failed to load")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.trusthalalGmaps = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        loaderPromise = null; // allow retry
        reject(new Error("Google Maps script failed to load"));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return loaderPromise;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GooglePlacesAutocomplete({
  onPick,
  onTextChange,
  placeholder = "Search for a place",
  className,
  autoFocus,
  disabled,
  id,
}: Props) {
  const apiKey = config.googleMapsApiKey;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!apiKey) return;
    const inputEl = inputRef.current;
    if (!inputEl) return;

    let listenerHandle: { remove: () => void } | null = null;
    let cancelled = false;

    setStatus("loading");
    loadMapsScript(apiKey)
      .then(() => {
        if (cancelled) return;
        const win = window as MapsWindow;
        const Autocomplete = win.google?.maps?.places?.Autocomplete;
        if (!Autocomplete) {
          throw new Error("google.maps.places.Autocomplete not available");
        }

        const widget = new Autocomplete(inputEl, {
          fields: [...AUTOCOMPLETE_FIELDS],
          types: ["establishment"],
          ...(COUNTRY_RESTRICTIONS.length
            ? { componentRestrictions: { country: COUNTRY_RESTRICTIONS } }
            : {}),
        });

        listenerHandle = widget.addListener("place_changed", () => {
          const place = widget.getPlace();
          if (!place.place_id) return;
          onPick({
            place_id: place.place_id,
            name: place.name ?? null,
            formatted_address: place.formatted_address ?? null,
          });
        });

        setStatus("ready");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err.message);
      });

    return () => {
      cancelled = true;
      listenerHandle?.remove();
    };
    // onPick is intentionally omitted: we capture it fresh via closure, and
    // rebuilding the Autocomplete widget on every parent re-render would be
    // wasteful (and would tear down the dropdown state mid-interaction).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Key-missing path: show a helpful banner instead of a dead input so
  // the panel still works end-to-end without Google credentials.
  if (!apiKey) {
    return (
      <div
        className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground"
        role="status"
      >
        <p className="font-medium text-foreground">Autocomplete disabled</p>
        <p className="mt-1">
          Set <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
          in <code className="font-mono">.env.local</code> and restart the dev
          server to enable the Places picker.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        ref={inputRef}
        id={id}
        type="text"
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled || status === "loading"}
        onChange={(e) => onTextChange?.(e.currentTarget.value)}
        className={cn(className)}
        // Autocomplete's dropdown is appended to document.body with a
        // z-index that can end up below Radix dialogs. The global styles
        // for .pac-container bump it above; we rely on that stylesheet.
        autoComplete="off"
        spellCheck={false}
      />
      {status === "loading" && (
        <p className="text-xs text-muted-foreground">Loading Google Places…</p>
      )}
      {status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          Couldn&apos;t load Google Places{errorMsg ? `: ${errorMsg}` : "."}
        </p>
      )}
    </div>
  );
}
