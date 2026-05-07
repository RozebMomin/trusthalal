/**
 * US states + territories + DC, used by the org-onboarding state
 * dropdown.
 *
 * We store the two-letter USPS code in the database (matches what
 * a state-LLC search expects). The owner sees the full name in the
 * dropdown for disambiguation, plus the abbreviation in parens so
 * power-users can pattern-match by code.
 *
 * Includes territories (PR, GU, etc.) since restaurants there are
 * eligible for the directory and an LLC can be filed there. If/when
 * we add Canadian provinces or other jurisdictions, layer them in
 * via a country-keyed map and let the UI pick which set to render.
 */

export type UsStateOption = {
  /** Two-letter USPS code, stored in the DB. */
  code: string;
  /** Full name shown in the dropdown. */
  name: string;
};

export const US_STATES: ReadonlyArray<UsStateOption> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  // Territories — eligible LLC jurisdictions for some entities.
  { code: "AS", name: "American Samoa" },
  { code: "GU", name: "Guam" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "PR", name: "Puerto Rico" },
  { code: "VI", name: "U.S. Virgin Islands" },
];

/**
 * Lookup helper for the rare case the UI needs the human label
 * given a stored code (e.g. an admin viewer rendering an org's
 * region without re-running the form).
 */
export function usStateLabelFromCode(code: string | null): string | null {
  if (!code) return null;
  const match = US_STATES.find((s) => s.code === code.toUpperCase());
  return match ? match.name : code;
}
