"use client";

/**
 * Read-only renderer for the halal-questionnaire JSONB.
 *
 * The server stores submissions as a permissive JSONB — fields are
 * marked optional so a draft can save partial progress and still
 * round-trip. By the time admin sees the claim it's PENDING_REVIEW,
 * which means it passed the strict re-validation at submit time, so
 * the required fields will be populated. This component is defensive
 * anyway: missing fields render a "—" rather than crashing, because
 * (a) defensive UI makes the admin tool harder to break with bad
 * data and (b) admin might still open a DRAFT claim from the place
 * detail surface in a future iteration.
 *
 * Layout is a flat definition list — admin scans for problems, and
 * a list of label/value rows is the fastest format to eyeball.
 */
import * as React from "react";

import type {
  AlcoholPolicy,
  HalalQuestionnaireDraft,
  MeatSourcing,
  MenuPosture,
  SlaughterMethod,
} from "@/lib/api/hooks";

const MENU_POSTURE_LABELS: Record<MenuPosture, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Mixed — separate kitchens",
  HALAL_OPTIONS_ADVERTISED: "Halal options advertised",
  HALAL_UPON_REQUEST: "Halal upon request",
  MIXED_SHARED_KITCHEN: "Mixed — shared kitchen",
};

const ALCOHOL_LABELS: Record<AlcoholPolicy, string> = {
  NONE: "None on premises",
  BEER_AND_WINE_ONLY: "Beer and wine only",
  FULL_BAR: "Full bar",
};

const SLAUGHTER_LABELS: Record<SlaughterMethod, string> = {
  ZABIHAH: "Zabihah",
  MACHINE: "Machine (halal-certified)",
  NOT_SERVED: "Not served",
};

function dash() {
  return <span className="text-muted-foreground">&mdash;</span>;
}

function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value === true) return <span>Yes</span>;
  if (value === false) return <span>No</span>;
  return dash();
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function MeatRow({
  label,
  meat,
}: {
  label: string;
  meat: MeatSourcing | null | undefined;
}) {
  if (!meat) {
    return <Row label={label}>{dash()}</Row>;
  }
  return (
    <Row label={label}>
      <div className="space-y-0.5">
        <div className="font-medium">
          {SLAUGHTER_LABELS[meat.slaughter_method] ?? meat.slaughter_method}
        </div>
        {(meat.supplier_name || meat.supplier_location) && (
          <div className="text-xs text-muted-foreground">
            {[meat.supplier_name, meat.supplier_location]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>
    </Row>
  );
}

export function QuestionnaireView({
  questionnaire,
}: {
  questionnaire: HalalQuestionnaireDraft | null | undefined;
}) {
  if (!questionnaire) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
        Owner hasn&apos;t saved any questionnaire answers yet.
      </p>
    );
  }

  const menuLabel = questionnaire.menu_posture
    ? MENU_POSTURE_LABELS[questionnaire.menu_posture] ??
      questionnaire.menu_posture
    : null;
  const alcoholLabel = questionnaire.alcohol_policy
    ? ALCOHOL_LABELS[questionnaire.alcohol_policy] ??
      questionnaire.alcohol_policy
    : null;

  return (
    <div className="rounded-md border bg-card">
      <header className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Questionnaire</h3>
        <p className="text-xs text-muted-foreground">
          Schema version{" "}
          <code className="font-mono">
            v{questionnaire.questionnaire_version ?? 1}
          </code>
        </p>
      </header>

      <dl className="divide-y px-4">
        <Row label="Menu posture">
          {menuLabel ? <span className="font-medium">{menuLabel}</span> : dash()}
        </Row>
        <Row label="Pork on the menu?">
          <YesNo value={questionnaire.has_pork} />
        </Row>
        <Row label="Alcohol policy">
          {alcoholLabel ? (
            <span className="font-medium">{alcoholLabel}</span>
          ) : (
            dash()
          )}
        </Row>
        <Row label="Alcohol used in cooking?">
          <YesNo value={questionnaire.alcohol_in_cooking} />
        </Row>

        <Row label="Seafood-only kitchen?">
          <YesNo value={questionnaire.seafood_only} />
        </Row>

        <MeatRow label="Chicken sourcing" meat={questionnaire.chicken} />
        <MeatRow label="Beef sourcing" meat={questionnaire.beef} />
        <MeatRow label="Lamb sourcing" meat={questionnaire.lamb} />
        <MeatRow label="Goat sourcing" meat={questionnaire.goat} />

        <Row label="Has certification?">
          <YesNo value={questionnaire.has_certification} />
        </Row>
        <Row label="Certifying body">
          {questionnaire.certifying_body_name?.trim() ? (
            <span className="font-medium">
              {questionnaire.certifying_body_name}
            </span>
          ) : (
            dash()
          )}
        </Row>

        <Row label="Owner caveats">
          {questionnaire.caveats?.trim() ? (
            <p className="whitespace-pre-wrap">{questionnaire.caveats}</p>
          ) : (
            dash()
          )}
        </Row>
      </dl>
    </div>
  );
}
