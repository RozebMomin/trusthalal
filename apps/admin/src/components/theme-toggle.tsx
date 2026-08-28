"use client";

import { Moon, Sun } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Light/dark toggle. The `dark` class on <html> is the source of truth — an
 * inline script in the layout sets it before paint (from localStorage, else
 * the OS preference), so there's no flash. This just flips that class and
 * persists the explicit choice.
 */
export function ThemeToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const [dark, setDark] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Private mode / storage disabled — the choice just won't persist.
    }
  }

  // Until mounted we don't know the real theme (SSR renders light), so show a
  // neutral icon to avoid a flicker to the wrong glyph.
  const Icon = mounted && dark ? Sun : Moon;
  const label = mounted ? (dark ? "Light mode" : "Dark mode") : "Theme";

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}
