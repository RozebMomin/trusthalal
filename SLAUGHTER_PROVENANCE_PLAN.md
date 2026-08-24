# Slaughter-Provenance & Certifier Model — Build Plan (v2, decisions locked)

**Prepared for:** Mohamad · **Status:** decisions locked · **Date:** 2026-08-24

---

## IMPLEMENTATION STATUS (updated as I build)

**Environment limit:** this workspace has no Python deps installed, so I can
`py_compile` backend files and `tsc` the frontends, but I **cannot run the pytest
suite or apply Alembic migrations** here. Everything below is py_compile-clean and
follows existing house patterns, but the migrations + tests need a run in your
env before deploy.

### >>> CURRENT STATE: entire BACKEND done & committed; FRONTEND (both consumer
### apps) + admin/verifier-capture UIs remain. Backend is coherent on its own —
### it writes AND reads the zabihah axis for red meat; the API is deploy-safe.
### The frontends still send/read the old `*_slaughter` fields for red meat, so
### until they're updated the red-meat filter is an inert no-op and cards still
### show the old label. Land the frontend before deploying so display matches.

### Done & committed:
- **Phase 1 — certifier registry** (`5ca5464`… actually commit `24fffe5`): new
  `app/modules/certifiers/` (models + enums), migration `ff60718293a4` creating
  `certifiers` / `certifier_aliases` / `certifier_adverse_events` + **seed of the
  9 bodies, their aliases, and the ISA conviction adverse event**; admin API
  (`/admin/certifiers` list/get/create/patch/aliases/adverse-events/**resolve**);
  tests in `tests/test_certifiers.py`.
- **Phase 2 — supplier attribution** (`2ba842b`): `ZabihahStatus` enum;
  `zabihah_status` + `certifier_id` on `supplier_products`; migration
  `a17182930405` that **resolves existing free-text certifier names → certifier_id
  via aliases** and **backfills red-meat lines** (Hand/Machine → ZABIHAH, else
  UNSURE); admin product schemas/repo updated.
- **Phase 3a — profile columns + verifier bridge** (`5ca5464`): `ZabihahStatus`
  on `halal_profiles`; `beef_zabihah` / `lamb_zabihah` / `goat_zabihah` columns
  (old `*_slaughter` retained, unread) + migration `b28293040516` backfilling
  them; **fixed the lossy `_FINDING_TO_SLAUGHTER` bridge** — red meat now maps
  1:1 to the zabihah axis (bootstrap + refresh write the zabihah columns).

- **Phase 3b — API read-path + filters** (`4f7280c`): `beef/lamb/goat_zabihah`
  added to `HalalProfileEmbed` (populated straight from the profile columns);
  search query params + `HalalSearchFilters` + `_apply_halal_filters` switched
  red meat to the zabihah columns (the "include Unsure" toggle is just the
  frontend adding UNSURE to the list); owner-claim approval now writes the
  zabihah columns via a `_zabihah_rollup` in `halal_profiles/service.py`.

### Remaining
**A. Consumer frontend (web + mobile) — the deploy-blocking piece.** Coupled to
consumer_preferences, so do them together:
1. **Types:** add `beef/lamb/goat_zabihah` to `HalalProfileEmbed`; change the
   red-meat `SearchPlacesParams` fields from `*_slaughter` → `*_zabihah`
   (`ZabihahStatus[]`). (consumer `src/lib/api/hooks.ts`; mobile
   `src/lib/api/types.ts` + `hooks.ts` `searchParamsToQuery`.)
2. **Filter sheets:** red-meat section → a Zabihah toggle + "include Unsure"
   option (drop hand/machine for beef/lamb/goat; keep it for chicken).
   (`components/filters-sheet.tsx`, mobile `components/FiltersSheet.tsx`,
   `countFilters`/`countActiveFilters`.)
3. **page.tsx / URL + prefs mapping:** `effectiveFilters`, `isUsingSavedPrefs`,
   `RELAXABLE`/URL param round-trip switch red meat to `*_zabihah`.
4. **Display:** red-meat badge → attributed "Zabihah — certified by [body], as
   stated by the restaurant" reading `*_zabihah` + `certifying_body_name`
   (place-result-card, place-trust-summary, mobile PlaceCard + `[id].tsx`,
   `lib/slaughter-display` equivalents). Chicken unchanged.
5. **consumer_preferences:** migrate `beef/lamb/goat_slaughter` → zabihah
   (column rename migration + convert values HAND/MACHINE→ZABIHAH; schema
   validator to ZABIHAH/NOT_ZABIHAH/UNSURE; repo; both prefs UIs). NOTE:
   PUT `/me/preferences` is `extra="forbid"`, so the frontend and backend prefs
   fields MUST rename together or saves 422.

**B. Phase 4 — admin UI + verifier capture:** admin certifier picker + zabihah
field + adverse-event display + `/suppliers/<slug>` fix; verifier capture:
restore red-meat zabihah findings in mobile + staff visit UIs (`file-visit.tsx`
`SLAUGHTER_FINDINGS` → per-meat: red meat gets `["ZABIHAH","NOT_ZABIHAH",
"NOT_SERVED","UNSURE"]`), add optional cert-body field, extend
`_resolve_verifier_suppliers`.

**C. Phase 5 — verify:** run pytest + `tsc` all apps; drop the retained
`*_slaughter` red-meat columns in a cleanup migration.

**Deferred/known-legacy (non-breaking):** `_embed_with_products`'s
`supplier_provenance` loop + `resolve_place_method`'s profile fallback still read
`beef_slaughter` for red meat (the retained column). Red-meat *supplier-link*
composition on the zabihah axis is a later refinement; the primary badge already
reads `beef_zabihah`.

**Why I paused here:** the committed foundation is a clean, non-breaking unit. The
remainder is tightly coupled and consumer-facing, and I can't run the test suite
or migrations in this environment — so it's safer to land it with tests/tsc in
your env (and ideally a quick review of this status) than to push a large
big-bang blind. Say "keep going" and I'll continue straight through the read-path
+ frontends.

---

_(original plan continues below)_

v1 digested the research. v2 reflects the decisions you made — which **cut the
scope by more than half**. We are no longer trying to independently verify
packers or research cut geometry (both dead-ends). We shift to an **attribution
model** for red meat.

---

## 1. Decisions — LOCKED

| # | Decision | Answer |
|---|---|---|
| D-1 | Red-meat consumer axis | **Attribution model.** Restaurant declares Zabihah / Not zabihah / Unsure; if zabihah, names the product + certifying body. We display it as *their* attributed claim; we do **not** verify the packer. Local supplier → build a supplier link. |
| D-2 | Certifying-body storage | **Canonical registry.** Named bodies resolve to a maintained list (aliases, one entry per body). Seed from the 9-row research CSV. |
| D-3 | Cut geometry / "not disclosed" | **No cut geometry at all.** Dropped entirely — too hard to research. |
| D-4 | Per-field "evidence basis" tag | **Drop it.** Reuse the existing owner-stated / verifier-confirmed evidence + line tier we already have. |
| Red flags | Certifier adverse events (e.g. ISA conviction) | **Admin-only context.** Recorded and shown to your team; not surfaced to consumers yet. |
| Poultry | Chicken / turkey / duck | **Unchanged.** Keep hand/machine; consumer decides their own definition of zabihah (per your earlier call). |

**Guiding principle you set:** *"they list the product and the certifying body,
and we are in the clear."* Trust Halal relays attributed claims and surfaces who's
attesting; it does not certify the supply chain. The consumer judges the named body.

---

## 2. The model

**Species intentionally diverge — that's correct, it matches reality:**

- **Poultry (CHICKEN, TURKEY, DUCK):** unchanged. `slaughter_method` = HAND_CUT /
  MACHINE_CUT / NOT_SERVED / NOT_DISCLOSED. We name the method; the consumer
  decides what counts as zabihah.
- **Red meat (BEEF, LAMB, GOAT):** new `zabihah_status` axis = **ZABIHAH /
  NOT_ZABIHAH / UNSURE / NOT_SERVED**. When ZABIHAH, the record carries the
  **product name** and the **certifying body** the restaurant attributes it to
  (resolved to the canonical registry). Displayed as an attributed claim:
  *"Zabihah beef — certified by [body], as stated by the restaurant."*
- **FISH / OTHER:** no slaughter axis (not applicable).

**Attribution, not verification.** The badge language makes the source explicit
(restaurant-stated vs verifier-confirmed — using the evidence fields we already
have). Naming a certifying body is the restaurant's claim; we canonicalize the
body and can annotate it internally, but we don't assert we checked the plant.

**Local-supplier path.** If a place sources red meat from a local supplier rather
than a big packer, they say so and we build a `PlaceSupplierLink` the normal way.
Local suppliers are contactable, so those links can strengthen over time — this
uses the mechanism that already exists.

---

## 3. What this DROPS from the research (big simplification)

Gone entirely: `cut_geometry` + `cut_geometry_basis`, `vessels_severed`,
`slaughter_est` / `processing_est`, `tasmiyah_mode`, the whole `EvidenceBasis`
per-field machinery, the species CHECK that policed cut geometry, and the
certifier "rule" fields (`permits_vertical_cut`, `permits_stunning`, etc.). That
was the majority of the research's schema. We keep only what the attribution
model needs.

`stunning` already exists on the line and stays as an optional field; we don't
expand it.

---

## 4. Schema delta (concrete)

### 4.1 New enum
`ZabihahStatus` = `ZABIHAH | NOT_ZABIHAH | UNSURE | NOT_SERVED` (house idiom:
`sa.Enum(..., native_enum=False)` → VARCHAR + CHECK).

### 4.2 Certifier registry (lean)
New module `app/modules/certifiers/`:
- **`certifiers`** — `id`, `slug` (unique), `name`, `legal_entity` (independence
  groups on this, never `name` — fixes the Crescent "three programs, one entity"
  problem), `country_code`, `website`, `notes`. *(We deliberately omit the
  cut-rule columns from the research CSV — not needed under attribution.)*
- **`certifier_aliases`** — `alias` (unique) → `certifier_id`. Resolves
  "IFANCA"/"IFANCC"/misspellings/trading names to one entry.
- **`certifier_adverse_events`** — `certifier_id`, `event_type`, `occurred_on`,
  `summary`, `source_url`. **Admin-only.** Gives ISA's conviction a home.
- **Seed** from `certifier_registry.csv` (9 rows): take slug/name/legal_entity/
  country/website; seed the ISA adverse event from its notes. Ignore the CSV's
  cut/stunning rule columns.

### 4.3 Attribution FK on the product line
`SupplierProduct` gains `certifier_id` (FK → `certifiers`, SET NULL). Existing
free-text `certifying_body_name` is resolved through `certifier_aliases` in a data
migration and kept as a display fallback / capture buffer.

`SupplierProduct` also gains `zabihah_status` (`ZabihahStatus`, nullable or
defaulting to `UNSURE`) for red-meat lines. `slaughter_method` stays for poultry.

### 4.4 Profile per-meat columns + the last-week integration (the main cost)
Today `HalalProfile` has `chicken/beef/lamb/goat_slaughter` (all `SlaughterMethod`),
and we just shipped consumer **filters** + **preferences** on all four.

- **Chicken** column: unchanged (hand/machine).
- **Beef / lamb / goat**: migrate from a slaughter-method axis to a **zabihah
  axis** — either repurpose the columns to `ZabihahStatus` or add
  `beef/lamb/goat_zabihah` and retire the `_slaughter` ones. This flows through:
  - `resolve_place_method` / provenance composition (red meat composes zabihah
    status + attributed body instead of method).
  - Consumer + mobile **filters**: red-meat axis becomes "Zabihah / Unsure"
    instead of hand/machine (poultry filter unchanged).
  - **`consumer_preferences`**: the `beef/lamb/goat_slaughter` columns + the
    prefs UI migrate to the zabihah axis (chicken stays slaughter). This undoes
    part of last week's red-meat filter/preferences shape — the mechanism stays,
    the vocabulary changes.
  - Amenity badges, active-filter chips: relabel for red meat.

This integration is the bulk of the front-end work and touches migration
`ee5f60718293` territory; it's mechanical but spans API + both apps.

### 4.5 Reused as-is (no change)
`SupplierAttachment` (attach the Wayne Farms cert to a line — already possible),
`SupplierEvent` (audit log), `Stunning`, `PlaceSupplierLink` evidence/source tiers,
`SupplierTier` line tier.

### 4.6 Verifier visit flow — how it meshes (important)

Good news: the verifier layer was **already designed for this**.
`VerifierMeatFinding` already carries meat-appropriate values —
`HAND_CUT`/`MACHINE_CUT` for poultry, **`ZABIHAH`/`NOT_ZABIHAH` for red meat**,
plus `NOT_SERVED`/`UNSURE`. So the schema-of-intent is right. Three things need
attention:

**(a) A capture-UI regression to undo.** The mobile + staff visit UIs currently
present `HAND_CUT`/`MACHINE_CUT`/`NOT_SERVED`/`UNSURE` for **all** meats (a prior
"hand/machine everywhere" pass — `SLAUGHTER_FINDINGS` is used for beef/lamb/goat
too). `ZABIHAH`/`NOT_ZABIHAH` survive in the type only, to render old visits. Fix:
restore the per-meat split — red meat offers `ZABIHAH`/`NOT_ZABIHAH`/`NOT_SERVED`/
`UNSURE`; poultry keeps hand/machine. The `findingsFor(meat)` helper already
supports per-meat option lists, so this is a small data change in
`apps/mobile/app/file-visit.tsx` and the staff equivalent.

**(b) The lossy profile bridge to fix — this is the real defect.**
`_FINDING_TO_SLAUGHTER` in `admin/verifiers/visits_repo.py` currently squashes
red-meat findings into hand/machine columns:

```
ZABIHAH      → HAND_CUT      # collapses to a poultry vocab
NOT_ZABIHAH  → MACHINE_CUT   # semantically WRONG — "not zabihah" is not "machine-cut"
```

Under the new model this bridge splits by species: poultry findings → the
slaughter columns (unchanged); red-meat findings map **1:1** into the new
`zabihah_status` columns (`ZABIHAH→ZABIHAH`, `NOT_ZABIHAH→NOT_ZABIHAH`,
`UNSURE→UNSURE`, `NOT_SERVED→NOT_SERVED`). Applied in both
`_bootstrap_profile_from_visit` and `_refresh_profile_from_visit`.

**(c) Cert-body attribution to add.** For a red-meat `ZABIHAH` finding, capture
the certifying body the verifier saw named (strongest when `evidence=CERTIFICATE`
— the cert's issuer). `VerifierMeatCheck` already carries `supplier_name`
(free text) + `evidence` (VERBAL/INVOICE/CERTIFICATE); add an optional
certifying-body field that resolves to the certifier registry (admin reconciles,
same pattern as the existing supplier-name → registry flow). On accept, extend
`_resolve_verifier_suppliers` to attach/create a supplier product carrying
`zabihah_status` + `certifier_id` at `VERIFIER_CONFIRMED` evidence.

**Confidence framing stays consistent with your earlier call:** owner-attributed
zabihah reads "as stated by the restaurant"; a verifier confirming it on a random
day is the top tier. Both write the same `zabihah_status`, differentiated by the
evidence/source tiers we already track (`SourcingEvidence` / `LinkSource` /
`MeatCheckEvidence`) — no new confidence machinery. This is exactly the "verifier
visit is the highest tier" model you settled on earlier.

---

## 5. Phased build

**Phase 0 — Data corrections (no schema; do first).** The audit's factual fixes,
now filtered to what the attribution model needs: Midamar (attach ISA adverse
event once the registry exists — or note now), Al Barakah (soften SBNY claim),
Perdue (fix location), Cargill (fix country), Crescent (one legal entity), Farmer
Focus (close VERIFY flag), Saffron Road (re-check FAQ), Wayne Farms (attach cert
photo — mechanism exists today).

**Phase 1 — Certifier registry (backend, additive).** `certifiers` +
`certifier_aliases` + `certifier_adverse_events`, seed 9 rows + ISA event, admin
list/detail. No consumer change.

**Phase 2 — Attribution fields (backend).** `ZabihahStatus` enum; `certifier_id`
+ `zabihah_status` on `SupplierProduct`; resolve free-text bodies → `certifier_id`.

**Phase 3 — Profile + filter/preferences migration + verifier bridge.** Move
beef/lamb/goat from the slaughter axis to the zabihah axis across API + consumer +
mobile (§4.4). Fix the lossy `_FINDING_TO_SLAUGHTER` bridge to split by species
and write the new `zabihah_status` columns 1:1 in bootstrap + refresh (§4.6b). The
larger, cross-cutting piece.

**Phase 4 — Admin UI + verifier capture.** Admin: certifier picker (typeahead →
certifier_id) on the product line, zabihah-status field for red meat,
adverse-event display on supplier + certifier views, `/suppliers/<slug>`
skeleton-hang fix. Verifier capture: restore the per-meat finding split in the
mobile + staff visit UIs (zabihah for red meat) and add the optional cert-body
field (§4.6a, §4.6c); extend `_resolve_verifier_suppliers` to carry
`zabihah_status` + `certifier_id` on accept.

**Phase 5 — Consumer display.** Attributed red-meat badge ("Zabihah — certified by
[body], as stated by the restaurant"), the local-supplier link surfacing, and the
relabeled red-meat filter.

Phases 1–2 are additive and consumer-invisible — safe to start immediately. The
product-visible changes are Phases 3–5. The verifier capture-UI change (§4.6a)
and the bridge fix (§4.6b) should ship together so a newly captured red-meat
finding doesn't round-trip through the old lossy mapping.

---

## 6. Small assumptions I'll make unless you say otherwise
- **Red-meat filter (LOCKED):** a zabihah toggle **plus an "include Unsure"
  option** per red meat. Default (toggle on, include-unsure off) shows only
  zabihah; stricter diners keep it tight, lenient diners opt Unsure back in.
  Poultry filter unchanged.
- `zabihah_status` defaults to `UNSURE` (parallel to `NOT_DISCLOSED` for poultry).
- Naming a certifying body is optional even when ZABIHAH (some restaurants won't
  know it) — we still show "Zabihah, restaurant-stated" with no body.
- Certifier registry is admin-curated; restaurants/owners pick from it or type a
  name that admin later resolves to an entry.
- FISH / OTHER: no slaughter axis surfaced.
- Verifier cert-body capture is **optional**: a verbal "they said it's zabihah,
  certified by X" still records (evidence=VERBAL, body unresolved for admin to
  reconcile later); seeing an actual certificate is the strong path.
- **Old-data backfill (LOCKED):** existing red-meat values map
  `HAND_CUT → ZABIHAH`, `MACHINE_CUT → ZABIHAH` (any prior positive method →
  zabihah), `NOT_SERVED → NOT_SERVED`, `NOT_DISCLOSED/null → UNSURE`.
  **Implementation nuance to preserve honesty:** backfilled zabihah inherits the
  *original record's* evidence/source tier — it does **not** get promoted to
  verifier-confirmed. So a previously owner-stated hand-cut becomes an
  owner-stated zabihah ("as stated by the restaurant"), never a Trust-Halal-
  verified one. This keeps the badge lit per your call without over-asserting.

## 7. Traps still in force
- Group certifiers by `legal_entity`, never `name` (Crescent).
- Don't treat "certificate on file" as evidence about slaughter (Wayne Farms cert
  is a *processing* cert).
- `null` ≠ `false` if we ever store accreditation states.
- Automated certifier verification isn't reliable (JS-gated sites) — the registry
  is admin-curated, not scraped.

## 8. Out of scope (confirmed)
Cut geometry, vessels, EST numbers, tasmiyah mode, per-field evidence basis,
certifier strictness ranking, auto-classifying anything from marketing copy.
