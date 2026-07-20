/**
 * How each filter is named when we tell someone it's the reason they got
 * nothing back.
 *
 * Keyed by the server's machine field name, and phrased as the thing they
 * asked for rather than the parameter, because the sentence it lands in is
 * "no places here have ___".
 *
 * Kept identical to the web copy in apps/consumer/src/components/
 * filters-sheet.tsx. Someone who hits a dead end on their phone and again on
 * their laptop should get one explanation, not two that almost agree.
 *
 * NOTE: nothing on mobile reads this map today — the empty state's body copy
 * doesn't name the offending filter, and its buttons use
 * FILTER_BUTTON_LABELS below. It's kept because the phrasing is the shared
 * one and the body copy is the natural place for it if that sentence ever
 * gets specific. Don't wire it into a button; that's what broke the layout.
 */
export const FILTER_LABELS: Readonly<Record<string, string>> = {
  min_validation_tier: "that level of verification",
  min_menu_posture: "that kind of menu",
  has_certification: "a certificate on file",
  no_pork: "no pork on the menu",
  no_alcohol_served: "no alcohol served",
  chicken_slaughter: "that chicken slaughter method",
  beef_slaughter: "that beef slaughter method",
  lamb_slaughter: "that lamb slaughter method",
  goat_slaughter: "that goat slaughter method",
};

/**
 * The same filters named for a BUTTON rather than a sentence.
 *
 * The labels above are written to complete "no places here have ___", which
 * makes them articled and demonstrative — "that level of verification". Drop
 * one into a third-width button on a phone and you get
 * "Drop that level of verification (1)": three lines tall, with the word
 * "verification" split across two of them, in a row where its two siblings
 * are one line each.
 *
 * So button copy is its own vocabulary: no article, no demonstrative, name
 * the thing being dropped.
 *
 * The constraint that matters is the LONGEST WORD, not the total length. A
 * long label just wraps to a second line; a single word wider than the button
 * is what breaks mid-word, because that's the one case text has no legal
 * place to break. The button is 132pt at its narrowest with 24pt padding a
 * side, leaving ~84pt, and at 16px ExtraBold that's about 8 characters. So:
 * no word here over 7 letters. "verification" (12) is exactly what this
 * replaced, and it needed ~119pt.
 */
export const FILTER_BUTTON_LABELS: Readonly<Record<string, string>> = {
  // "trust level" over "verification level": same idea, and it echoes the
  // "Trust profile" heading the tiers already live under.
  min_validation_tier: "trust level",
  min_menu_posture: "menu type",
  // Spaced, not hyphenated — "no-alcohol" is one 10-letter token to a text
  // layout engine and would break where the others don't.
  has_certification: "cert on file",
  no_pork: "no pork",
  no_alcohol_served: "no alcohol",
  chicken_slaughter: "chicken method",
  beef_slaughter: "beef method",
  lamb_slaughter: "lamb method",
  goat_slaughter: "goat method",
};
