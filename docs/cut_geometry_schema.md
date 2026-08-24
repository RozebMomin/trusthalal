# Cut Geometry — Schema Recommendation + Certifier Reference Table

**For:** Trust Halal supplier/product-line data model
**Date:** 2026-08-23

---

## 1. Why "European cut / other" fails as a field

Three reasons, in order of severity.

**(a) "Other" silently merges two opposite states.** A product where you have *confirmed* a horizontal cut and a product where you have *no idea* both land in "other." Those are not the same record. Across this session, roughly every product examined has landed in "no idea" — so "other" would become 90% of your table and mean nothing.

**(b) The term "vertical cut" is genuinely ambiguous.** Four authorities define it four incompatible ways:

| Source | Definition |
|---|---|
| ISA (quoted in AMJA) | *"cutting from the chin down"* — longitudinal neck cut |
| HFSAA | *"inserting a knife vertically into the thoracic cavity, starting from the heart and ending at the throat"* |
| Darul Iftaa Chicago | *"cut along a vertical line from the chest to the throat"* |
| HTO (defending it) | *nahr* = *"a longitudinal cut followed by a horizontal cut"* |

HTO's version is a **hybrid** — it has a horizontal component. If your enum is binary, HTO-certified beef cannot be classified honestly either way.

**(c) Direction is a proxy, not the actual religious test.** Classical fiqh specifies the *location* (madhbaḥ) and the *vessels*, never the knife's direction. Hanafi requires any three of four (trachea, esophagus, two jugulars); Shāfiʿī the esophagus and windpipe; Mālikī the trachea plus both jugulars. AMJA's objection to the European cut is precisely that *"the trachea and the esophagus of an animal are not severed."* Direction matters only because it predicts vessel severance. Store the thing that matters.

---

## 2. Recommended schema

### `cut_geometry` (enum) — BEEF/RED MEAT ONLY

| Value | Meaning |
|---|---|
| `TRANSVERSE_HORIZONTAL` | Single horizontal cut across the front of the throat. The method AHF and HFSAA mandate. |
| `LONGITUDINAL_VERTICAL` | Chin-down / midline longitudinal cut as the primary killing cut. The "European cut." |
| `HYBRID_NAHR` | Longitudinal incision followed by a horizontal cut. HTO's certified *nahr* method. **Must be its own value** — it is neither of the above. |
| `THORACIC_STICK_PRIMARY` | Chest stick toward the heart as the primary killing cut (distinct from a secondary stick after a valid throat cut). |
| `NOT_DISCLOSED` | **DEFAULT.** No published information. Expect this on the large majority of records. |
| `NOT_APPLICABLE` | Poultry. See §4. |

### `secondary_thoracic_stick` (enum)
`YES_AFTER_CUT` / `NO` / `NOT_DISCLOSED`

Malaysia's National Fatwa Council permitted thoracic sticking on 29 Sep 2005 **on condition** the animal dies from the initial vessel severance and the stick occurs only after bleeding begins. A stick *after* a valid throat cut is a different thing from a stick *instead of* one. Do not collapse them.

### `vessels_severed` (multi-select) — the field that actually decides it
`TRACHEA` / `ESOPHAGUS` / `CAROTID_L` / `CAROTID_R` / `JUGULAR_L` / `JUGULAR_R` / `NOT_DISCLOSED`

### `evidence_basis` (enum) — **the most important field in this schema**

| Value | Meaning |
|---|---|
| `PLANT_DOCUMENTED` | A document about *this plant* states the method |
| `CERTIFIER_STANDARD_IMPLIES` | Inferred from the certifier's published written rule |
| `CERTIFIER_SILENT` | The certifier publishes nothing on cut geometry |
| `THIRD_PARTY_ALLEGATION` | Claimed by a critic or advocacy body, plant not confirming |
| `PRODUCER_CLAIM` | The producer says so, unverified |

**Rationale:** for nearly every product you will only ever have certifier-level inference. Recording *what* without recording *how you know* is how a 60%-confidence inference hardens into a displayed fact. Keep them in separate columns.

### `spinal_cord_severed` (enum)
`YES` / `NO` / `NOT_DISCLOSED` — GSO 993 cl. 4.4.4 prohibits severing the head or breaking the neck; WOAH concurs.

### `cut_approach` (enum)
`ANTERIOR` / `LATERAL` / `DORSAL` / `NOT_DISCLOSED`

This is the axis GSO 993 actually regulates (cl. 4.4.3): *"The neck should be cut at the front above the chest... and not from either side of the neck or from the back."* Note it is a different axis from vertical/horizontal, and applies to poultry too (cl. 4.7.6).

---

## 3. Put the field on the CERTIFIER, not just the product

This is the highest-leverage change. Cut method is almost never published per plant, but it *is* published per certifier. Add to your certifier table:

### `permits_vertical_cut` (enum): `PROHIBITS` / `PERMITS` / `SILENT`

| Certifier | Value | Evidence |
|---|---|---|
| **HMA Canada** | `PROHIBITS` | *"Sticking, poking, carrying out a vertical cut prior to the incision or doing a double cut during the slaughter will render the animal uncertified."* https://hmacanada.org/hma-guidelines/ |
| **HFSAA** / Halal Advocates | `PROHIBITS` | Rejects "Vertical cut/beef sticking of cattle," "Modified vertical cut," "Cutting fewer than 3 of the blood vessels." Requires *"horizontal incision to the throat."* https://www.hfsaa.org/about · https://www.hfsaa.org/articles/beef-sticking |
| **AHF** | `PROHIBITS` (by exclusive mandate) | *"slaughtering must be carried out from the front of the neck using a horizontal (transverse) cut only"* https://halalfoundation.org/ahf-halal-standards/ |
| **HTO** | `PERMITS` | Certifies *nahr* = *"a longitudinal cut followed by a horizontal cut"* https://halaltransactions.wordpress.com/2014/09/12/creekstone-farms-update/ |
| **IFANCA** | `PERMITS` a hybrid; rejects the label | *"The cut at the Cargill/Better Beef plant is not vertical cut. It is modified horizontal cut."* https://ifanca.org/ifanca-responds-to-rumors-about-halal-certification-at-cargill-better-beef-plant/ |
| **ISWA** | `SILENT` | Requires hand slaughter for large animals, permits reversible stunning; **no cut geometry published** https://www.ushalalcertification.com/ |
| **ISA** | `SILENT` | Standards cover sharp knife, tasmiya, Muslim slaughterer. No direction, no vessel count. https://www.isahalal.com/services/industries-we-serve/meat-poultry |
| **HMS** | `SILENT` | Public pages assert "Zabiha Halal procedures" without technical specification. https://hmsusa.org/certification-process |

**Note:** of the five US bodies Indonesia's BPJPH accredits for slaughtering scope (AHF, HTO, IFANCA, ISA, ISWA), **four either permit a hybrid cut or are silent on direction.** https://www.fas.usda.gov/data/indonesia-indonesia-accredits-five-us-halal-certifying-bodies

---

## 4. Poultry: do not use this field

Vertical/horizontal is a **cattle** vocabulary. No halal-sector source applies it to poultry. The poultry orientation axis is **ventral vs. dorsal**, and the Humane Slaughter Association is explicit: automated neck cutters *"must not be set up to deliver a dorsal neck cut because a) this may miss both common carotid arteries and result in a slow bleed-out, and b) it may damage the spinal cord."* https://www.hsa.org.uk/electrical-waterbath-stunning-of-poultry-bleeding/automated-mechanical-neck-cutters

**Poultry fields instead:** `hand_vs_machine`, `ventral_vs_dorsal`, `unilateral_vs_bilateral_blade`, `tasmiyah_mode` (per-bird / recorded / blanket), `stun_parameters`, `backup_slaughterman_present`.

The two field sets are near-perfect complements — machine-vs-hand is the poultry question, vertical-vs-horizontal is the beef question — which is exactly why they get conflated.

---

## 5. A warning for your product-claim parsing

**"Hand-slaughtered zabiha, no stunning" is NOT evidence of a horizontal cut.**

Nearly every US zabiha-branded beef product advertises hand slaughter, and virtually none states cut direction. Saad Wholesale Meats markets under a registered mark reading "SPECIALIZING IN ZABIHA HALAL" and says *"clean cut to the jugular vein"* — no direction — and is certified by **HTO**, the body that permits the longitudinal cut. Crescent Foods' detailed hand-slaughter language applies to **chicken**; its beef page says only *"All our cattle is Hand Processed Halal."*

Do not let a `hand_slaughtered = true` flag auto-populate `cut_geometry`. They are independent.
