# Halal supplier research playbook

> **Purpose:** a repeatable method for building/extending the supplier registry — from a handful of names to a nationwide sweep — that stays accurate, sourced, and legally defensible.
> **Use this when** asked to "research halal suppliers," "expand the seed registry," or "go far and wide across the US." Feed the output into `2026-08-11-supplier-seed-registry.md` (same shape).
> **First principle:** we record **what a supplier publicly states**, cited and dated, at `LISTED` confidence — never a Trust Halal verdict. When the method isn't stated, it's `NOT_DISCLOSED`, and that gap is itself useful signal. Never manufacture a method to make a list look balanced.

---

## 1. What we're capturing

Per **product line** (species/SKU class), not per company — one supplier's chicken and beef can differ:

- `slaughter_method`: `HAND_CUT` · `MACHINE_CUT` · `NOT_DISCLOSED`
- `stunning` (optional): `STUNNED` · `NON_STUNNED` · `NOT_DISCLOSED`
- `certifying_body_name` (the certifier is a strong prior — §4)
- `source_url` + read date (mandatory on every line)
- `line_tier` / `verification_tier`: always `LISTED` from research; higher tiers require a document on file or a traced audit, which is a separate verification step, not research.

## 2. Source hierarchy (trust the top, flag the bottom)

1. **Primary — the supplier's own site.** Look for `/our-process`, `/faq`, `/certification`, `/halal`, `/about`. Direct statements like "hand-slaughtered by a Muslim," "non-stunned," "mechanical slaughter with a blesser." → citable at `LISTED`.
2. **Certifier listings & statements.** HMS / HFSAA / IFANCA / ISA certified-business directories and their published method standards. Strong corroboration; a certifier's posture (§4) fills gaps the supplier didn't state — but record it as the certifier's rule, not proof for a specific SKU.
3. **Reputable trade/press.** MEAT+POULTRY, local public-media investigations, IFANCA/HFSAA articles. Good for facts the supplier won't self-publish (e.g. industrial hand-slaughter at Cargill).
4. **Secondary guides/blogs/marketplaces** (halal-listicles, B2B export listings, retailer product pages). Use only to *find* candidates, then confirm upstream. If a method claim rests only on these → mark the row **VERIFY** and, if the method is unstated, keep it `NOT_DISCLOSED`.

Never treat a **brand name** as evidence of method. "Zabiha Halal" (Al Safa) is a brand, not a slaughter fact; export pages saying "hand-slaughtered" for mass Brazilian poultry are marketing, not confirmation.

## 3. Search patterns that work

- `"<supplier>" halal slaughter method hand OR machine certification`
- `"<supplier>" our process zabiha stunning`
- `<certifier> certified <species> hand slaughter <metro>`
- `halal <species> distributor <metro/state>` (regional coverage)
- `"halal" <species> "machine slaughtered" OR "mechanical slaughter"` (to surface the machine cases, which are usually generic)
- Certifier directories: `HMS certified listing processors`, `IFANCA certified companies`, `HFSAA certified`.

Then **fetch the supplier's own page** to lift the exact wording + URL for the citation.

## 4. Certifier as a method signal (prior, never proof)

| Certifier | Posture | Implication |
| --- | --- | --- |
| **HMS** (Halal Monitoring Services / Shariah Board of America) | Hand-slaughter only; whole-chain monitoring | Strong `HAND_CUT` |
| **HFSAA** (Halal Food Standards Alliance of America) | Hand-slaughter, non-stun | Strong `HAND_CUT` |
| **SBNY / Shariah boards** (regional) | Hand-slaughter zabiha | Strong `HAND_CUT` |
| **IFANCA** | Permits controlled **mechanical** *and* hand | Ambiguous → read the product line |
| **ISA** (Islamic Services of America) | Certifies both | Ambiguous |
| **Halal Transactions of Omaha (HTO)** | Client-dependent (Perdue hand, Superior lamb hand) | Read the product |
| **ISNA / AHF / ISWA / USA Halal Chamber (ISWA)** | Recognized; varies | Ambiguous |

Rule of thumb from the data: **beef and lamb are hand-slaughtered even at industrial scale**; **mechanical is overwhelmingly a poultry phenomenon**, and machine-cut "halal" chicken is mostly **generic/private-label/imported and unbranded** — so expect the branded set to skew hand-cut, and don't force it otherwise.

## 5. Coverage strategy for a nationwide sweep

Sweep along four axes so the registry isn't just famous national brands:

1. **National brands** (Crescent, Midamar, Saffron Road, Perdue Harvestland, Al Safa…).
2. **Regional distributors/processors by metro** — Chicago, NYC, Detroit/Dearborn, DFW, Houston, LA/Anaheim, Bay Area, Atlanta, DC/NoVA, Minneapolis, Philly. Query `halal meat distributor <metro>` + `zabiha wholesale <metro>`.
3. **Local butchers & farms** (Honest Chops, Halal Pastures, Al Barakah…) — often the strictest hand-cut, relevant because restaurants source locally.
4. **Importers** (Brazil/BRF-Sadia, Australia/NZ lamb, UAE/Al Islami) — often mechanical or stunned; usually ends up `NOT_DISCLOSED`/`VERIFY`.

For each candidate: confirm method per species from a primary source, capture certifier, cite, date. Aim for breadth of *channel and geography*, not just count.

## 6. Honesty & legal rules (non-negotiable)

1. Every product line carries a `source_url` and read date. No citation → don't record the method.
2. Default to `NOT_DISCLOSED`; never guess. Unstated ≠ machine, and unstated ≠ a demerit.
3. Everything enters at `LISTED`. Research does not promote tiers.
4. Method claims resting on secondary/marketing sources → mark **VERIFY** in notes.
5. These are **claims about named third parties** — a legal surface. Keep it factual and attributed; re-check on a cadence; correct fast. Prefer the supplier's own words.
6. Keep **out of scope**: animal-welfare controversies, business disputes, anything that isn't slaughter method / stunning / certifier. (Flag welfare/tayyib items to the founder as possible *future* attributes; don't encode them as method facts.)
7. **Neutrality:** record method + certifier + source; never rank hand-cut above machine-cut or attach approving/disapproving language.

## 7. Output format

- **Structured JSON** matching the `SupplierProduct` schema (see the seed registry doc's embedded block): `suppliers[].{name, slug, aliases, website_url, city, region, country_code, verification_tier, certifying_body_name, notes, products[].{meat_type, product_name, slaughter_method, stunning, line_tier, certifying_body_name, source_url}}`.
- **Readable table** (supplier · lines · method · stun · certifier · source) for human review, plus per-supplier notes calling out any `VERIFY`.
- Idempotent on `slug` so re-runs upsert rather than duplicate.

## 8. Freshness / re-check

- Stamp `as_of` on the batch and `last_verified_at` per row.
- Re-check `LISTED` rows periodically (suppliers change plants, certifiers, and methods; certificates expire). A stale "hand-cut" claim about a named company is exactly the error that carries legal and trust cost.
- Promotion above `LISTED` happens only via the verification workflow (document on file / traced audit → `supplier_events` `VERIFIED`), never via this playbook.

## 9. Pitfalls seen in practice

- **Brand name ≠ method** ("Zabiha Halal" brand, `NOT_DISCLOSED` method).
- **Export/marketplace pages** overclaim "hand-slaughtered" for mass poultry — confirm upstream.
- **Certifier ≠ SKU** — an IFANCA mark doesn't tell you hand vs machine for a given line.
- **"Halal certified" on a label** frequently means machine-slaughtered; the strict signal is the explicit words "hand slaughtered."
- **Welfare investigations** are tempting to note but are out of method scope and legally sensitive — keep them out of the data.

---

*Promote-to-skill note:* if this gets used often, wrap it as a skill (`skill-creator`) so it can be invoked by name; the content above is the skill body.
