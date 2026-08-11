# Supplier provenance & slaughter-method — build plan

> **Purpose:** make slaughter method a *supplier* fact instead of a restaurant claim, verified once at the supplier and propagated to every restaurant that sources from it — while retiring "zabihah" as an asserted status. Built on top of the existing halal-claim / profile / tier / verifier / dispute stack, not a rebuild.
> **Audience:** the coding agent, plus whoever owns brand copy.
> **Companion:** `zabihah-redefinition.md` (the "why"). This doc is the "how," reconciled with the real schema.

---

## 0. The reframe in one paragraph

The slaughter fact belongs to the **supplier** (e.g. Crescent Farms hand-cuts poultry), not the restaurant. We build a curated, verified **Supplier registry**; restaurants attach to suppliers via a **sourcing link** that carries its *own* evidence tier; the confidence a consumer sees is the **weaker of the two links** (supplier-fact confidence × sourcing-link confidence), always dated. A restaurant visit can't confirm how meat two links up the chain was slaughtered — so method confidence is decoupled from the restaurant's verification tier. Almost every honesty mechanism this needs (tiers, evidence attachments, expiry/decay, disputes, an audit/visit workflow, un-blocked slaughter vocabulary) **already exists**; we are mostly adding two entities and one composition rule.

---

## 1. What already exists — reuse, don't rebuild

Verified against the live schema (all in `api/app/modules/…`, DB schema `app`):

- **Per-meat slaughter, already granular.** `HalalProfile` has `chicken_slaughter`, `beef_slaughter`, `lamb_slaughter`, `goat_slaughter`, each a `SlaughterMethod` enum. **This is better than the "mixed" bucket in the redefinition doc** — "hand-cut chicken, machine-cut beef" is already expressible per column. **We drop the proposed `MIXED` value entirely.** `halal_profiles/models.py`, `halal_profiles/enums.py`.
- **Supplier already captured as free text.** Each `MeatProductSourcing` entry in a claim's `structured_response` JSONB has `supplier_name`, `supplier_city`, `supplier_state`, `certifying_authority`, `certificate_number`. This is our **migration on-ramp** — real supplier names already sit in the data. `halal_claims/schemas.py`.
- **Restaurant verification tiers.** `ValidationTier = {SELF_ATTESTED, CERTIFICATE_ON_FILE, TRUST_HALAL_VERIFIED}` on `HalalProfile`, assigned at claim approval by `derive_profile_from_approved_claim(...)` (rollup rule: *least-conservative wins* per meat). `halal_profiles/service.py`.
- **Evidence + audit patterns to mirror.** `HalalClaimAttachment` (cert/invoice/letter with `issuing_authority`, `certificate_number`, `valid_until`) and `HalalClaimEvent`; `VerificationVisit` (`structured_findings`, `disclosure`, admin SUBMITTED→ACCEPTED workflow, tier promotion) — the cleanest template for a supplier audit later. `halal_claims/models.py`, `verifiers/models.py`.
- **Consumer filtering already joins the profile.** `GET /places` (there is **no** `/places/search`; the root path *is* search) already accepts `chicken_slaughter` / `beef_slaughter` / `lamb_slaughter` / `goat_slaughter` multi-value filters via `HalalSearchFilters` + `_apply_halal_filters` (INNER JOIN `HalalProfile`, `revoked_at IS NULL`). `places/router.py`, `places/repo.py`.
- **Disputes cover this attribute.** `DisputedAttribute.SLAUGHTER_METHOD_INCORRECT` exists; `ConsumerDispute` snapshots `contested_profile_id`; a confirmed dispute can spawn a `RECONCILIATION` claim. `disputes/models.py`.
- **Slaughter vocabulary is already un-blocked.** `_BLOCKING_CATEGORIES` in `core/text_moderation.py` deliberately excludes `Violent` / `Death, Harm & Tragedy` (removed after "zabihah" got mis-blocked). No regression to make — just don't re-add them.
- **Freshness/decay precedents to copy.** `HalalProfile.last_verified_at` / `expires_at` (90-day cap) / `revoked_at`; `certificate_expires_at`; `Place.google_synced_at` (the "as of <date>" precedent).

---

## 2. Vocabulary decision (reconciled with the schema)

The redefinition doc proposed `HAND_CUT / MACHINE_CUT / MIXED / NOT_DISCLOSED`. Reconciled to the real per-meat enum, the change to `SlaughterMethod` (`halal_profiles/enums.py`) is:

| Today | New | Label |
| --- | --- | --- |
| `ZABIHAH` ("Hand-slaughtered with bismillah") | `HAND_CUT` | "Hand-slaughtered" |
| `MACHINE` | `MACHINE_CUT` | "Machine-slaughtered" |
| — | `NOT_DISCLOSED` (new) | "Method not disclosed" |
| `NOT_SERVED` | `NOT_SERVED` (unchanged) | "Not served here" |

- **Drop `MIXED`** — per-meat columns already express it.
- **`NOT_DISCLOSED` is new and load-bearing:** today a served-but-unknown meat has no honest value (it would be miscoded). It becomes the default for "serves this meat, method unknown," distinct from `NOT_SERVED`.
- **Retire "zabihah" as a stored value / badge / boolean.** Keep the word only in educational and search copy (redefinition doc §3), and — per the strategy call — keep it deliberately as a **discovery/search term**, not near-banned. Update `docs/brand/voice-and-guardrails.md`.
- The `ZABIHAH → HAND_CUT` change is a **rename of the same fact** (hand-slaughtered), not a guessed backfill — so migrating existing rows is honest.

---

## 3. New entities

### 3a. `Supplier` — the company `[BUILD]`
Table `app.suppliers`. **Admin-curated in MVP** (suppliers are a small, stable set; no crowd-submission flow needed yet). The company row carries identity and a *company-level baseline* tier; the actual **method lives on product lines** (§3a-bis), because one supplier's SKUs vary — hand-slaughtered poultry but machine-slaughtered beef is common.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | `gen_random_uuid()` |
| `name` | String(255) NOT NULL | "Crescent Foods" |
| `slug` | String(120) UNIQUE | for a future public supplier page |
| `aliases` | `ARRAY(Text)` | matches free-text names already in claims |
| `website_url` | Text? | provenance / public source |
| `country_code` / `region` / `city` | String | HQ / plant location |
| `verification_tier` | enum `SupplierTier` NOT NULL, default `LISTED` | **company-level** confidence ceiling — how well we've vetted the *company* (public listing vs cert on file vs audited). A product line can never compose above this. |
| `certifying_body_name` | String(255)? | company-wide certifier, if one covers everything |
| `notes` | Text? | admin-facing provenance summary |
| `last_verified_at` | timestamptz NOT NULL default now() | freshness |
| `revoked_at` | timestamptz? | soft-revoke; excludes the whole company and its lines from public reads |
| `created_at` / `updated_at` | timestamptz NOT NULL | |

### 3a-bis. `SupplierProduct` — the product line `[BUILD]`
Table `app.supplier_products`. **This is where the method lives.** One row per product line / SKU class a supplier offers (e.g. "whole chicken", "chicken leg quarters", "ground beef"), each with its own method, certifier, and evidence — because they genuinely differ within one company.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `supplier_id` | UUID FK `app.suppliers.id` CASCADE, indexed | |
| `meat_type` | enum `MeatType` NOT NULL | `CHICKEN`, `BEEF`, … |
| `product_name` | String(255) NOT NULL | "whole chicken", "leg quarters", "ground beef" |
| `slaughter_method` | enum `SlaughterMethod` NOT NULL, default `NOT_DISCLOSED` | **the fact, per line** |
| `line_tier` | enum `SupplierTier` NOT NULL, default `LISTED` | per-line confidence; **capped at `supplier.verification_tier`** in composition |
| `certifying_body_name` | String(255)? | line-specific certifier (may differ by SKU) |
| `certificate_number` / `certificate_url` / `certificate_expires_at` | | mirror `HalalProfile` cert fields |
| `stunning` | enum? (`STUNNED` / `NON_STUNNED` / `NOT_DISCLOSED`) | optional; leave nullable for the later stunning attribute (redefinition doc §10.2) |
| `source_url` | Text? | where the public claim was read (seed provenance) |
| `notes` | Text? | |
| `last_verified_at` | timestamptz NOT NULL default now() | freshness (per line) |
| `evidence_expires_at` | timestamptz? | cert/audit TTL |
| `created_at` / `updated_at` | | |

Index `(supplier_id, meat_type)`. A supplier with undifferentiated product still gets at least one row per meat it covers.

Companion tables (mirror the claim ones): `app.supplier_attachments` (audit letter / cert / plant report on either the company or a line — nullable `supplier_id` + `supplier_product_id`; reuse `HalalClaimAttachmentType` values) and `app.supplier_events` (append-only audit log on the company: `LISTED`, `VERIFIED`, `CERT_UPDATED`, `LINE_ADDED`, `REVOKED`, `CORRECTED`).

`SupplierTier` (supplier-fact confidence — parallel to `ValidationTier`, separate enum):
- `LISTED` — added from public info, no document on file
- `CERTIFICATE_ON_FILE` — supplier's halal cert / third-party audit doc on file, unexpired
- `TRUST_HALAL_VERIFIED` — we traced/audited the plant or its paperwork directly

### 3b. `PlaceSupplierLink` — the sourcing link `[BUILD]`
Table `app.place_supplier_links`. The restaurant↔product-line edge, with its **own** evidence tier. Links target a **`SupplierProduct`**, not the company, so "sources hand-cut leg quarters from Crescent" is distinct from what Crescent does with beef.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `place_id` | UUID FK `app.places.id` CASCADE, indexed | |
| `supplier_product_id` | UUID FK `app.supplier_products.id` RESTRICT, indexed | the specific line |
| `meat_type` | enum `MeatType` NOT NULL | denormalized from the product for fast filtering; must equal the product's |
| `evidence_tier` | enum `SourcingEvidence` NOT NULL, default `OWNER_STATED` | sourcing-link confidence (§4) |
| `source` | enum | `OWNER_CLAIM` / `VERIFIER_VISIT` / `ADMIN` — how the link was created |
| `source_claim_id` / `source_visit_id` | UUID? FK SET NULL | provenance |
| `note` | Text? | "buys leg quarters weekly" |
| `last_confirmed_at` | timestamptz NOT NULL default now() | freshness / "as of" |
| `expires_at` | timestamptz? | link goes stale → auto-downgrade |
| `ended_at` | timestamptz? | restaurant switched suppliers |
| `created_at` / `updated_at` | | |

Partial unique index on `(place_id, supplier_product_id) WHERE ended_at IS NULL` — one live link per (place, product line). A restaurant can hold several live links (different lines / suppliers) for the same meat; the read path (§4) picks the best-evidenced one per meat.

`SourcingEvidence` (sourcing-link confidence):
- `OWNER_STATED` — owner's word only
- `DOCUMENTED` — invoice/receipt/supplier letter on file naming this restaurant
- `VERIFIER_CONFIRMED` — a verifier saw the sourcing evidence in person (boxes in the walk-in, delivery invoices) on a visit

### 3c. Supplier verification — MVP is admin-curated `[REUSE later]`
Do **not** build a supplier-submission workflow in MVP. Admin creates and verifies suppliers with attachments (`supplier_events` records each step). When field verification of suppliers is warranted later, reuse the `VerificationVisit` pattern (`structured_findings` + `disclosure` + admin decision) pointed at a supplier instead of a place.

---

## 4. Confidence composition — the core rule `[BUILD]`

A pure, unit-testable function (e.g. `halal_profiles/provenance.py`):

```
compose_method_confidence(place, meat) ->
    { method: SlaughterMethod, confidence: MethodConfidence, as_of: date|None, supplier: Supplier|None }
```

Logic:
1. Find all **live** `PlaceSupplierLink`s for `(place, meat)` (`ended_at IS NULL`, not past `expires_at`) whose `SupplierProduct` covers that meat and whose `Supplier.revoked_at IS NULL`.
2. For each, the line's **effective supplier confidence** = `min(supplier.verification_tier, supplier_product.line_tier)` (a line can never out-rank the company's vetting). The link's composed confidence = `min(effective_supplier_confidence, link.evidence_tier)`, mapped onto the shared ladder.
3. Pick the **best-evidenced** live link for that meat (highest composed confidence; tie-break newest `last_confirmed_at`). Result: `method = supplier_product.slaughter_method`, `confidence`, `supplier`, `as_of = min(supplier_product.last_verified_at, link.last_confirmed_at)`.
4. If no live link → fall back to the questionnaire's per-meat value on `HalalProfile`, at `SELF_STATED` confidence, `as_of = HalalProfile.last_verified_at`.

Shared 3-rung `MethodConfidence` ladder (so supplier tier and sourcing tier compose): `SELF_STATED (1) < DOCUMENTED (2) < VERIFIED (3)`. Map `SupplierTier` and `SourcingEvidence` onto it; **the minimum of every link in the chain governs.** A `TRUST_HALAL_VERIFIED` product line reached by an `OWNER_STATED` sourcing link is only `SELF_STATED` — a rock-solid supplier fact never launders a flimsy sourcing claim.

**Hard rules (lintable):**
1. A supplier link **never** changes the restaurant's `ValidationTier`. Two independent axes.
2. Method confidence is **never** rendered green / "confirmed" unless it composes to `VERIFIED`.
3. Never display a bare "Hand-cut" — always with its confidence caveat and `as_of` (§7).

---

## 5. Profile / read-path integration `[REUSE + extend]`

- Keep `derive_profile_from_approved_claim` as-is for the **owner's self-attested** per-meat baseline (unchanged rollup).
- Add supplier-backed method to the **public read path** (`halal_profiles/repo.py::get_public_halal_profile` + `public_meat_products`): for each served meat, run `compose_method_confidence` and attach `{method, confidence, as_of, supplier_name}` to the per-product read model. Do **not** overwrite the stored profile columns — composition is a read-time enrichment, so a supplier change is reflected immediately without re-deriving.
- The supplier-backed value is **not a second badge** and must not visually outrank the `ValidationTier` chip.

---

## 6. Owner flow `[REUSE + extend]`

In the existing questionnaire `MeatProductSourcing` row (owner claim editor, `apps/owner/src/app/my-halal-claims/[id]/page.tsx` + `get-verified/halal`):
- Add an **optional** `supplier_id` (autocomplete against the registry) beside the existing free-text supplier fields. Free text stays for suppliers not yet in the registry.
- Picking a registry supplier shows its known method **read-only** ("Crescent Foods — hand-cut poultry, supplier verified"), but the resulting link is `OWNER_STATED` until documented.
- Optional invoice attachment on the claim can later be reviewed by admin to bump the link to `DOCUMENTED`.
- **Never force it.** "Prefer not to say" / leaving it blank persists `NOT_DISCLOSED`, and submitting a supplier link **does not** bump the restaurant `ValidationTier`.

---

## 7. Consumer filter + display `[REUSE + extend]`

**Filter** (`GET /places`, extend `HalalSearchFilters`):
- After the `ZABIHAH→HAND_CUT` rename, the existing `chicken_slaughter=hand_cut` filter already works — no new method param needed.
- Add one boolean: `supplier_verified=true` → only places whose matched meat is backed by a link composing to `DOCUMENTED`+ against a non-revoked supplier. Implement as an EXISTS subquery on `place_supplier_links` joined to `suppliers`; **do not** secretly narrow by `ValidationTier`.

**Display** (place detail halal block, consumer + mobile): bind method to the weaker-link caveat and date. Examples:
- `VERIFIED`: "Chicken: hand-slaughtered — sourced from Crescent Foods, supplier verified (confirmed 3 mo ago)"
- `DOCUMENTED`: "Chicken: hand-slaughtered — supplier invoice on file (Crescent Foods)"
- `SELF_STATED`: "Chicken: hand-slaughtered — as stated by the owner, not independently checked"
- fallback: "Chicken: method not disclosed"

Self-stated method never gets the confirming/green treatment (consistent with "self-attested is never green").

---

## 8. Disputes & moderation & analytics `[REUSE]`

- **Disputes:** reuse `SLAUGHTER_METHOD_INCORRECT`. A confirmed dispute can `ended_at` / downgrade a `PlaceSupplierLink` or `revoked_at` a `Supplier` (logged in `supplier_events`). Optionally add `DisputedAttribute.SOURCING_INCORRECT` later.
- **Moderation:** no change — keep slaughter vocabulary allowed; do not re-add `Violent` / `Death, Harm & Tragedy` to `_BLOCKING_CATEGORIES`.
- **Analytics (`track()`):** emit `supplier_verified`, `place_supplier_linked`, and `filter_applied {supplier_verified: true}` with **IDs and enum values only** — never supplier free-text notes, never query text (house rule).

---

## 9. Migrations (house idiom: `String(50)` + CHECK, hand-assigned mnemonic id, `schema="app"`)

Current head: **`w6c7d8e9f0a1`**. Three sequential migrations:

- **M1 — vocabulary.** Widen the `ck_*_slaughter` CHECK constraints to include `HAND_CUT`, `MACHINE_CUT`, `NOT_DISCLOSED`; `UPDATE … SET <meat>_slaughter = 'HAND_CUT' WHERE = 'ZABIHAH'` (and `MACHINE`→`MACHINE_CUT`) across the four columns; drop the old values from the CHECK. Update the `SLAUGHTER_METHOD` value tuple + the `SlaughterMethod` StrEnum in lock-step. No guessed backfill.
- **M2 — supplier registry.** `create_table` `app.suppliers`, `app.supplier_products`, `app.supplier_attachments`, `app.supplier_events` (String(50)+CHECK enums, `gen_random_uuid()`, indexes on name/slug/`revoked_at` and `supplier_products(supplier_id, meat_type)`).
- **M3 — sourcing links.** `create_table` `app.place_supplier_links` (FK to `supplier_products`) + the partial-unique and FK indexes.

`down_revision` chains M1→M2→M3 off `w6c7d8e9f0a1`. Not a terms change → no user re-prompt.

---

## 10. Rollout order (ship confidence before facts)

1. **M1 + copy** — the invisible reframe: `zabihah`→`hand-cut` vocabulary, `NOT_DISCLOSED`, brand docs. Ships first, changes no behavior.
2. **Supplier registry + admin curation UI** — seed the famous, documentable names (Crescent Foods, Midamar, …) at their real tier.
3. **Confidence composition + read-path enrichment + display caveats** — *before* any supplier method is surfaced, so nothing ever shows a method with false authority.
4. **Owner `supplier_id` link** (optional field).
5. **Consumer `supplier_verified` filter.**
6. **Dispute/analytics polish.**

---

## 11. Trust & longevity guardrails (from the strategy)

- Supplier facts are **claims about named third parties** → documentary, sourced, dated evidence bar; `revoked_at` + `supplier_events` give a fast, visible correction path. This is a real defamation/liability surface — treat the evidence bar as non-negotiable.
- The **sourcing link is the soft underbelly** — always scope per meat and date it; "sources from Crescent" must never render as "everything here is hand-cut."
- **`NOT_DISCLOSED` stays dignified and common** — never coerced into a guess, never a demerit.
- **Never answer "is it halal?"** — the composition returns *method + confidence + who + as-of*, never a verdict. Publish the methodology in `docs/brand/`.

---

## 12. Acceptance criteria / tests (mirror existing style, e.g. `test_supplier_provenance.py`)

- **Migration:** existing `ZABIHAH` rows read `HAND_CUT` after M1; no rows lost; CHECK passes; served-unknown can be set to `NOT_DISCLOSED`.
- **Composition:** unit table across `{SupplierTier} × {line_tier} × {SourcingEvidence}` — result is always the **minimum** rung; a line never out-ranks its company; expired/`ended_at`/`revoked_at` links fall back to self-attested.
- **Per-line divergence:** a supplier with hand-cut `CHICKEN` and machine-cut `BEEF` yields different methods per meat on the same linked restaurant; the chicken line and beef line resolve independently.
- **Best-evidenced wins:** with two live links for the same meat, the higher composed confidence is shown (newest breaks ties).
- **No tier laundering:** a `TRUST_HALAL_VERIFIED` line + `OWNER_STATED` link renders `SELF_STATED`, no green, and the place `ValidationTier` is unchanged.
- **Read path:** a served meat with no live link falls back to the questionnaire value at `SELF_STATED` with the profile's `last_verified_at`.
- **Filter:** `GET /places?supplier_verified=true` returns only places with a `DOCUMENTED`+ link to a non-revoked supplier, across all restaurant tiers.
- **Freshness:** an expired link (`expires_at` past) is excluded from `VERIFIED`/`DOCUMENTED` and drops to the self-attested fallback.
- **Dispute:** an upheld `SLAUGHTER_METHOD_INCORRECT` dispute can end a link / revoke a supplier and the read path reflects it immediately.
- **Analytics:** filter + link events carry enum/ids only, never supplier notes or query text.
