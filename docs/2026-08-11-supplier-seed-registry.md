# Supplier registry — initial seed

> **What this is:** a starter set of well-known US halal meat/poultry suppliers for the registry in `2026-08-11-supplier-provenance-plan.md`, with slaughter method captured **per product line** and every fact **sourced**.
> **Confidence of everything here:** `LISTED` only. Each row records **what the supplier states publicly**, read from the cited page on the date shown — **not** a Trust Halal verification. Nothing here may be surfaced above `LISTED` until we have a document on file or a traced audit. This is the honest floor, not a badge.
> **Legal note:** these are factual claims about named third parties. Keep the source URL on every row, re-check on a cadence, and correct fast (`revoked_at` + `supplier_events`). When in doubt, `NOT_DISCLOSED`.
> **As of:** 2026-08-11. **Count:** 14 suppliers / 30 product lines (26 hand-cut · 1 machine-cut · 3 not-disclosed) — the skew is real, see "Market reality" below.

---

## How method maps to the enum

- `HAND_CUT` — supplier publicly states each animal is hand-slaughtered by a Muslim reciting tasmiyah.
- `MACHINE_CUT` — supplier/its certifier describes mechanical/mechanized slaughter (blade on a line, blesser reciting).
- `NOT_DISCLOSED` — the public materials we read don't clearly state the method. **Not a demerit** — just unknown until verified.

**Certifier is a strong method signal** (see appendix): HMS and HFSAA certify **hand-slaughter only**; IFANCA **permits controlled mechanical**, so an IFANCA mark alone doesn't tell you the method — the product line does.

---

## Seed set (sourced)

| Supplier | Line(s) | Method (stated) | Stun | Certifier | Source |
| --- | --- | --- | --- | --- | --- |
| **Crescent Foods** (Chicago, IL) | chicken, beef, lamb, turkey | Hand-cut | Non-stunned | HMS / Shariah Board of America | crescentfoods.com/our-process |
| **Midamar** (Cedar Rapids, IA) | beef (+ other) | Hand-cut | — | ISA / ISNA | midamarhalal.com/pages/faq |
| **Saffron Road** (Stamford, CT) | chicken, lamb | Hand-cut | Non-stunned | IFANCA | saffronroad.com/faq |
| **One Stop Halal** (distributor, online US) | chicken, beef, lamb, goat | Hand-cut | Non-stunned (poultry) | HFSAA | onestophalal.com |
| **Perdue Harvestland Halal** (Omaha, NE) | chicken | Hand-cut | — | IFANCA / Halal Transactions of Omaha | perduefoodservice.com |
| **Honest Chops** (New York, NY — butcher) | chicken, beef, lamb | Hand-cut | — | states zabiha / hand-slaughter | honestchops.com |
| **Farmer Focus** (Harrisonburg, VA) | chicken | Machine-cut *(secondary source — verify)* | — | ISA | farmerfocus.com/halal-certified |
| **Al Safa Halal / "Zabiha Halal"** (brand) | chicken, beef | Not disclosed *(IFANCA-certified; hand-slaughter not stated on pages read — verify)* | — | IFANCA / IFANCC | alsafahalal.com/faqs |
| **Al Barakah** (New York, NY + Decatur, GA — distributor) | chicken, beef | Hand-cut | — | Shariah Board of New York | albarakahusa.com/about-us |
| **Barkaat Foods** (Chicago, IL — processor) | beef/veal, lamb, goat | Hand-cut *(verify from own site)* | — | — (zabiha, USDA plant) | cbinsights.com/company/barkaat-foods |
| **Halal Pastures** (Rock Tavern, NY — farm) | chicken, beef, lamb, goat | Hand-cut | — | Muslim family farm (self) | halalpastures.com/faq |
| **Cargill — "Better Beef" halal program** | beef | Hand-cut | — | IFANCA | ifanca.org (Cargill/Better Beef response) |
| **Superior Farms** (Denver, CO / N. California) | lamb | Hand-cut | — | Halal Transactions of Omaha / Islamic Enterprises & Services of America | will.illinois.edu |
| **Sadia (BRF)** (Brazil — imported) | chicken | Not disclosed *(export listings claim hand; large-scale BR poultry often mechanical — verify)* | — | — | brazilhalalchicken.com |

**Market reality (important, and an honest reason the set skews hand-cut):** the *named, marketed* US halal brands overwhelmingly advertise hand-slaughter, and beef/lamb stay hand-slaughtered even at industrial scale (Cargill, Superior Farms). Machine-slaughtered "halal" chicken **is** common in the US — by some accounts the majority of chicken sold under a bare "halal" label — but it's largely **generic and unbranded** (private-label, foodservice, imported), so it rarely attaches to a nameable supplier. Farmer Focus (machine, ISA) is the clearest branded machine example found; the rest surface as "halal, method unstated." Don't manufacture machine-cut brand attributions to "balance" the list — record `NOT_DISCLOSED` where the method isn't stated, which is itself the useful signal.

Notes on the soft rows: **Farmer Focus** is described as machine-slaughtered by a secondary guide, not its own page — carry it as `MACHINE_CUT` but flag for primary-source confirmation. **Al Safa** carries the "Zabiha Halal" brand name but the public FAQ we read doesn't state hand-slaughter, and IFANCA permits mechanical — so it's honestly `NOT_DISCLOSED` until confirmed, *despite the brand name*. That gap is exactly the thing the product exists to surface.

---

## JSON seed (matches the `SupplierProduct` schema; the eventual seed script lifts this)

```json
{
  "as_of": "2026-08-11",
  "default_tier": "LISTED",
  "tier_note": "Public-info only. Do not surface above LISTED without a document on file or a traced audit.",
  "suppliers": [
    {
      "name": "Crescent Foods",
      "slug": "crescent-foods",
      "aliases": ["Crescent Halal", "Crescent Hand-Cut"],
      "website_url": "https://crescentfoods.com",
      "city": "Chicago", "region": "IL", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "Halal Monitoring Services (HMS) / Shariah Board of America",
      "notes": "States every bird hand-slaughtered by a Muslim, non-stunned, Qiblah-facing; HMS chain-monitored.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken (whole & parts)", "slaughter_method": "HAND_CUT", "stunning": "NON_STUNNED", "line_tier": "LISTED", "certifying_body_name": "HMS", "source_url": "https://crescentfoods.com/our-process/"},
        {"meat_type": "BEEF", "product_name": "beef", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "HMS", "source_url": "https://crescentfoods.com/certification/"},
        {"meat_type": "LAMB", "product_name": "lamb", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "HMS", "source_url": "https://crescentfoods.com/certification/"},
        {"meat_type": "TURKEY", "product_name": "turkey", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "HMS", "source_url": "https://crescentfoods.com/certification/"}
      ]
    },
    {
      "name": "Midamar",
      "slug": "midamar",
      "aliases": ["Midamar Halal"],
      "website_url": "https://www.midamarhalal.com",
      "city": "Cedar Rapids", "region": "IA", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "Islamic Services of America (ISA) / ISNA",
      "notes": "Founded 1974; states all beef hand-cut zabiha, USDA-inspected.",
      "products": [
        {"meat_type": "BEEF", "product_name": "beef (roasts, ground, deli)", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "ISA/ISNA", "source_url": "https://www.midamarhalal.com/pages/faq"}
      ]
    },
    {
      "name": "Saffron Road",
      "slug": "saffron-road",
      "aliases": ["American Halal Company", "American Halal Co."],
      "website_url": "https://www.saffronroad.com",
      "city": "Stamford", "region": "CT", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "IFANCA",
      "notes": "States chicken and lamb 100% hand-slaughtered by a Muslim, no stunning of poultry.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken (entrees & raw)", "slaughter_method": "HAND_CUT", "stunning": "NON_STUNNED", "line_tier": "LISTED", "certifying_body_name": "IFANCA", "source_url": "https://saffronroad.com/faq"},
        {"meat_type": "LAMB", "product_name": "lamb", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "IFANCA", "source_url": "https://saffronroad.com/faq"}
      ]
    },
    {
      "name": "One Stop Halal",
      "slug": "one-stop-halal",
      "aliases": [],
      "website_url": "https://onestophalal.com",
      "city": null, "region": null, "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "HFSAA",
      "notes": "Online distributor; states hand-cut only, no high-speed automated line; poultry non pre-stunned.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken", "slaughter_method": "HAND_CUT", "stunning": "NON_STUNNED", "line_tier": "LISTED", "certifying_body_name": "HFSAA", "source_url": "https://onestophalal.com/pages/halal-certification"},
        {"meat_type": "BEEF", "product_name": "beef (incl. grass-fed, wagyu)", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "HFSAA", "source_url": "https://onestophalal.com/pages/halal-certification"},
        {"meat_type": "LAMB", "product_name": "lamb", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "HFSAA", "source_url": "https://onestophalal.com/pages/halal-certification"},
        {"meat_type": "GOAT", "product_name": "goat", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "HFSAA", "source_url": "https://onestophalal.com/pages/halal-certification"}
      ]
    },
    {
      "name": "Perdue Harvestland Halal",
      "slug": "perdue-harvestland-halal",
      "aliases": ["Harvestland Halal", "Perdue Halal"],
      "website_url": "https://www.perduefoodservice.com",
      "city": "Omaha", "region": "NE", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "IFANCA / Halal Transactions of Omaha",
      "notes": "Foodservice halal line; states hand-slaughtered, no-antibiotics-ever, vegetarian-fed.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken (foodservice)", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "IFANCA/HTO", "source_url": "https://www.perduefoodservice.com/the-perdue-difference/halal-certified/"}
      ]
    },
    {
      "name": "Honest Chops",
      "slug": "honest-chops",
      "aliases": [],
      "website_url": "https://honestchops.com",
      "city": "New York", "region": "NY", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": null,
      "notes": "Organic NYC butcher (retail; some restaurants source here). States all meat hand-slaughtered per strict zabiha.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://honestchops.com/"},
        {"meat_type": "BEEF", "product_name": "beef", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://honestchops.com/"},
        {"meat_type": "LAMB", "product_name": "lamb", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://honestchops.com/"}
      ]
    },
    {
      "name": "Farmer Focus",
      "slug": "farmer-focus",
      "aliases": ["Shenandoah Valley Organic"],
      "website_url": "https://www.farmerfocus.com",
      "city": "Harrisonburg", "region": "VA", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "Islamic Services of America (ISA)",
      "notes": "VERIFY: described as machine/mechanical slaughter by a secondary guide, not its own page. Confirm from primary source before use.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken", "slaughter_method": "MACHINE_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "ISA", "source_url": "https://www.farmerfocus.com/halal-certified/"}
      ]
    },
    {
      "name": "Al Safa Halal",
      "slug": "al-safa-halal",
      "aliases": ["Zabiha Halal", "Al Safa"],
      "website_url": "https://alsafahalal.com",
      "city": null, "region": null, "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "IFANCA / IFANCC",
      "notes": "VERIFY: brand markets as 'Zabiha Halal' but the FAQ read does not state hand-slaughter; IFANCA permits mechanical. Honestly NOT_DISCLOSED until confirmed.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken (frozen)", "slaughter_method": "NOT_DISCLOSED", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "IFANCA", "source_url": "https://alsafahalal.com/faqs/"},
        {"meat_type": "BEEF", "product_name": "beef (frozen)", "slaughter_method": "NOT_DISCLOSED", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "IFANCA", "source_url": "https://alsafahalal.com/faqs/"}
      ]
    },
    {
      "name": "Al Barakah",
      "slug": "al-barakah",
      "aliases": ["Al Barakah USA", "Al Barakah Zabiha Halal"],
      "website_url": "https://albarakahusa.com",
      "city": "New York", "region": "NY", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "Shariah Board of New York (SBNY)",
      "notes": "Distributor/retail (NY + Decatur, GA). States all meat & poultry hand-slaughtered by Muslims, SBNY-monitored.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "SBNY", "source_url": "https://albarakahusa.com/about-us/"},
        {"meat_type": "BEEF", "product_name": "beef", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "SBNY", "source_url": "https://albarakahusa.com/product-category/beef/"}
      ]
    },
    {
      "name": "Barkaat Foods",
      "slug": "barkaat-foods",
      "aliases": [],
      "website_url": "https://barkaatfoods.com",
      "city": "Chicago", "region": "IL", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": null,
      "notes": "VERIFY: USDA slaughterhouse/processor; described as zabiha for lamb, goat, veal, beef via a company profile — confirm method + certifier from barkaatfoods.com.",
      "products": [
        {"meat_type": "BEEF", "product_name": "beef/veal", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.cbinsights.com/company/barkaat-foods"},
        {"meat_type": "LAMB", "product_name": "lamb", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.cbinsights.com/company/barkaat-foods"},
        {"meat_type": "GOAT", "product_name": "goat", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.cbinsights.com/company/barkaat-foods"}
      ]
    },
    {
      "name": "Halal Pastures",
      "slug": "halal-pastures",
      "aliases": ["Halal Pastures Farm"],
      "website_url": "https://www.halalpastures.com",
      "city": "Rock Tavern", "region": "NY", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": null,
      "notes": "Muslim family farm (farm + NYC stands). States all animals hand-slaughtered, organic/grass-fed, tayyib emphasis.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "chicken", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.halalpastures.com/faq/"},
        {"meat_type": "BEEF", "product_name": "beef", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.halalpastures.com/faq/"},
        {"meat_type": "LAMB", "product_name": "lamb", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.halalpastures.com/faq/"},
        {"meat_type": "GOAT", "product_name": "goat", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.halalpastures.com/faq/"}
      ]
    },
    {
      "name": "Cargill (Better Beef halal program)",
      "slug": "cargill-better-beef-halal",
      "aliases": ["Better Beef"],
      "website_url": "https://www.cargill.com",
      "city": null, "region": null, "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "IFANCA",
      "notes": "Industrial-scale; per IFANCA all cattle hand-slaughtered by trained Muslim slaughtermen (modified horizontal cut). Evidence that beef stays hand-slaughtered even at scale.",
      "products": [
        {"meat_type": "BEEF", "product_name": "beef", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "IFANCA", "source_url": "https://ifanca.org/ifanca-responds-to-rumors-about-halal-certification-at-cargill-better-beef-plant/"}
      ]
    },
    {
      "name": "Superior Farms",
      "slug": "superior-farms",
      "aliases": [],
      "website_url": "https://superiorfarms.com",
      "city": "Denver", "region": "CO", "country_code": "US",
      "verification_tier": "LISTED",
      "certifying_body_name": "Halal Transactions of Omaha (Denver) / Islamic Enterprises & Services of America (N. California)",
      "notes": "Largest US lamb producer; halal lambs hand-slaughtered by trained Muslim slaughtermen.",
      "products": [
        {"meat_type": "LAMB", "product_name": "lamb", "slaughter_method": "HAND_CUT", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": "Halal Transactions of Omaha", "source_url": "https://will.illinois.edu/news/story/chances-are-youre-eating-halal-meat-and-dont-know-it"}
      ]
    },
    {
      "name": "Sadia (BRF)",
      "slug": "sadia-brf",
      "aliases": ["BRF", "Perdigao"],
      "website_url": "https://www.brf-global.com",
      "city": null, "region": null, "country_code": "BR",
      "verification_tier": "LISTED",
      "certifying_body_name": null,
      "notes": "VERIFY: Brazilian exporter, imported to US via distributors. Export listings claim hand-slaughter, but large-scale Brazilian poultry is commonly mechanical. NOT_DISCLOSED until confirmed from a primary source.",
      "products": [
        {"meat_type": "CHICKEN", "product_name": "frozen chicken", "slaughter_method": "NOT_DISCLOSED", "stunning": "NOT_DISCLOSED", "line_tier": "LISTED", "certifying_body_name": null, "source_url": "https://www.brazilhalalchicken.com/post/brazilian-halal-chicken-brands"}
      ]
    }
  ]
}
```

---

## Appendix — certifiers as a method signal (reference data)

Useful because a restaurant often knows its *certifier* even when it doesn't know the plant. Treat as a prior, never as proof of a given SKU.

| Certifier | Method posture | Implication |
| --- | --- | --- |
| **HMS** — Halal Monitoring Services (Shariah Board of America) | Hand-slaughter only; monitors the whole chain slaughterhouse→restaurant | Strong `HAND_CUT` signal |
| **HFSAA** — Halal Food Standards Alliance of America | Hand-slaughter, non-stun | Strong `HAND_CUT` signal |
| **IFANCA** — Islamic Food & Nutrition Council of America | Permits controlled **mechanical** (Muslim starts line + blesser recites) *and* hand | Ambiguous — read the product line |
| **ISA** — Islamic Services of America | Certifies both hand and machine | Ambiguous |
| **HTO** — Halal Transactions of Omaha | Used for Perdue Harvestland (hand) | Read the product |
| **ISNA / AHF / ISWA** | Recognized bodies; method varies by client | Ambiguous |

**Neutrality reminder:** none of the above is ranked in-product. The registry reports method + certifier + source + date and lets the user's own standard judge. "Zabiha Halal" as a *brand name* (Al Safa) is not evidence of method — a good reason the word is retired as an asserted status.

---

## Loading rules (for the seed script, once M2/M3 land)

1. Insert every supplier + product at `LISTED` / `line_tier=LISTED`, `last_verified_at = as_of`, `source_url` populated. Idempotent on `slug` (upsert), so re-running doesn't duplicate.
2. Never insert a link (`PlaceSupplierLink`) — seeding suppliers ≠ claiming any restaurant sources from them.
3. `MACHINE_CUT`/`NOT_DISCLOSED` rows flagged **VERIFY** in notes stay `LISTED` and must be primary-source-confirmed before promotion.
4. This file is the provenance record; keep it updated as rows are verified (bump the row, add the document to `supplier_attachments`, log a `supplier_events` `VERIFIED`).
