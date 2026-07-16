"use client";

/**
 * Shared building blocks for the parallel `/get-verified` onboarding
 * wizard. Everything here is presentational — the pages own the data
 * fetching + mutations and feed derived state in as props.
 *
 * Two families of UI live here:
 *
 *   * The HUB roadmap (`Roadmap` + `RoadmapStage`) — the three-stage
 *     status board rendered on `/get-verified`.
 *   * The FORM shell (`WizardShell` + `StepRail`) — the left-rail +
 *     content + sticky footer layout the three stage forms render in.
 *
 * Kept intentionally free of any hook wiring so it can't accidentally
 * couple the new flow to the existing pages.
 */

import {
  AlertTriangle,
  Check,
  Clock,
  Lock,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

// A stage's lifecycle state, shared by the rail and the roadmap.
//   todo    — not started, actionable (the user's turn)
//   now     — actionable + the highlighted current step
//   review  — submitted, waiting on Trust Halal (waiting on us)
//   fix     — bounced back, the user needs to act (rejected / needs info)
//   done    — cleared
//   lock    — not yet reachable (a prior gate hasn't cleared)
export type StageState =
  | "todo"
  | "now"
  | "review"
  | "fix"
  | "done"
  | "lock";

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------

const PILL_TONES: Record<string, string> = {
  action:
    "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  review:
    "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-100",
  done: "bg-primary text-primary-foreground",
  lock: "bg-muted text-muted-foreground",
  fix: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-100",
};

export function StagePill({
  tone,
  children,
}: {
  tone: keyof typeof PILL_TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide",
        PILL_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Roadmap (hub)
// ---------------------------------------------------------------------------

function StageNode({ index, state }: { index: number; state: StageState }) {
  if (state === "done") {
    return (
      <div className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-4 w-4" strokeWidth={3} />
      </div>
    );
  }
  if (state === "review") {
    return (
      <div className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-background text-amber-600 shadow-[0_0_0_4px] shadow-amber-100 dark:shadow-amber-950">
        <Clock className="h-4 w-4" strokeWidth={2.25} />
      </div>
    );
  }
  if (state === "lock") {
    return (
      <div className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-border bg-muted text-muted-foreground">
        <Lock className="h-3.5 w-3.5" strokeWidth={2.25} />
      </div>
    );
  }
  if (state === "fix") {
    return (
      <div className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-red-400 bg-background text-red-600 shadow-[0_0_0_4px] shadow-red-100 dark:shadow-red-950">
        <AlertTriangle className="h-4 w-4" strokeWidth={2.25} />
      </div>
    );
  }
  // now / todo
  const highlighted = state === "now";
  return (
    <div
      className={cn(
        "z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-background text-sm font-bold",
        highlighted
          ? "border-primary text-primary shadow-[0_0_0_4px] shadow-emerald-100 dark:shadow-emerald-950"
          : "border-border text-muted-foreground",
      )}
    >
      {index}
    </div>
  );
}

export function RoadmapStage({
  index,
  state,
  title,
  children,
  isLast = false,
}: {
  index: number;
  state: StageState;
  title: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  const locked = state === "lock";
  return (
    <div className="relative flex gap-4 pb-5 last:pb-0">
      <div className="flex flex-col items-center">
        <StageNode index={index} state={state} />
        {!isLast && <div className="mt-1 w-0.5 flex-1 bg-border" />}
      </div>
      <div
        className={cn(
          "flex-1 rounded-2xl border bg-card p-4 sm:p-5",
          locked && "border-dashed bg-muted/30",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            className={cn(
              "text-base font-semibold",
              locked && "text-muted-foreground",
            )}
          >
            {title}
          </h3>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Roadmap({ children }: { children: React.ReactNode }) {
  return <div className="mt-6">{children}</div>;
}

export function LockNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Form shell (stage 1/2/3) — left rail + content + sticky footer
// ---------------------------------------------------------------------------

export type RailStage = {
  title: string;
  sub: string;
  state: StageState;
};

export function StepRail({ stages }: { stages: RailStage[] }) {
  return (
    <aside className="shrink-0 border-b bg-muted/30 p-5 md:w-72 md:border-b-0 md:border-r">
      <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Get verified
      </p>
      <ol className="space-y-1">
        {stages.map((stage, i) => (
          <li
            key={stage.title}
            className={cn(
              "flex items-center gap-3 rounded-lg px-2.5 py-2.5",
              stage.state === "now" && "border bg-background",
            )}
          >
            <RailNode index={i + 1} state={stage.state} />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-semibold leading-tight",
                  stage.state === "lock" && "text-muted-foreground",
                )}
              >
                {stage.title}
              </p>
              <p className="text-[11.5px] text-muted-foreground">{stage.sub}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function RailNode({ index, state }: { index: number; state: StageState }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "lock") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border text-muted-foreground">
        <Lock className="h-3 w-3" strokeWidth={2.25} />
      </span>
    );
  }
  const highlighted = state === "now";
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold",
        highlighted
          ? "border-primary text-primary"
          : "border-border text-muted-foreground",
      )}
    >
      {index}
    </span>
  );
}

export function WizardShell({
  stages,
  title,
  lead,
  children,
  footer,
}: {
  stages: RailStage[];
  title: string;
  lead: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col md:flex-row">
          <StepRail stages={stages} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 p-6 md:p-8">
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
              <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                {lead}
              </p>
              <div className="mt-6">{children}</div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-6 py-4 md:px-8">
              {footer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
