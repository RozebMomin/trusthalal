/**
 * Fixture data mirroring the mockups word-for-word, so UI review
 * compares like with like. Swapped for live hooks at wiring time.
 */
import type { PlaceSearchResult } from "@/lib/api/types";

const profile = (over: object) => ({
  validation_tier: "SELF_ATTESTED" as const,
  menu_posture: "HALAL_OPTIONS_ADVERTISED" as const,
  chicken_slaughter: null, beef_slaughter: null, lamb_slaughter: null, goat_slaughter: null,
  has_pork: false, alcohol_policy: null, alcohol_in_cooking: false, seafood_only: false,
  has_certification: false, certifying_body_name: null,
  certificate_expires_at: null, certificate_url: null, certificate_content_type: null,
  caveats: null, last_verified_at: "2026-05-01T00:00:00Z",
  dispute_state: "NONE" as const,
  // null = "this surface didn't load it", which is what a search result
  // carries. Fixtures that want to exercise ServedProducts override it.
  meat_products: null,
  ...over,
});

export const FIXTURE_PLACES: PlaceSearchResult[] = [
  {
    id: "fx-karachi", name: "Karachi Grill House",
    address: "214 Peachtree St NE", lat: 33.759, lng: -84.387,
    city: "Atlanta", region: "GA", country_code: "US",
    cuisine_types: ["PAKISTANI", "BBQ"],
    hero_photo_url: "https://images.unsplash.com/photo-1544025162-d76694265947?w=800",
    halal_profile: profile({
      validation_tier: "TRUST_HALAL_VERIFIED", menu_posture: "FULLY_HALAL",
      chicken_slaughter: "ZABIHAH", beef_slaughter: "ZABIHAH", lamb_slaughter: "ZABIHAH",
      alcohol_policy: "NONE", has_certification: true, certifying_body_name: "IFANCA",
      // Deliberately mixed, because the uniform case hides the bug this
      // feature exists to fix: the rollup is least-conservative-wins, so
      // these two chicken products collapse to "Chicken · Machine" and a
      // diner can't tell the breast from the nuggets. One entry also has no
      // supplier, to exercise the "No supplier listed" branch.
      meat_products: [
        { meat_type: "CHICKEN", product_name: "Chicken tikka", slaughter_method: "ZABIHAH",
          supplier_name: "Crescent Foods", supplier_city: "Chicago", supplier_state: "IL",
          certifying_authority: "IFANCA" },
        { meat_type: "CHICKEN", product_name: "Chicken nuggets", slaughter_method: "MACHINE",
          supplier_name: "Midwest Poultry", supplier_city: null, supplier_state: "IL",
          certifying_authority: null },
        { meat_type: "BEEF", product_name: "Seekh kebab", slaughter_method: "ZABIHAH",
          supplier_name: null, supplier_city: null, supplier_state: null,
          certifying_authority: null },
      ],
    }),
  },
  {
    id: "fx-saffron", name: "Saffron Yemeni Kitchen",
    address: "88 Auburn Ave", lat: 33.755, lng: -84.38,
    city: "Atlanta", region: "GA", country_code: "US",
    cuisine_types: ["YEMENI"],
    hero_photo_url: "https://images.unsplash.com/photo-1547592180-85f173990554?w=800",
    halal_profile: profile({
      validation_tier: "CERTIFICATE_ON_FILE", menu_posture: "FULLY_HALAL",
      has_certification: true, certifying_body_name: "IFANCA",
    }),
  },
  {
    id: "fx-kabab-king", name: "Kabab King",
    address: "5775 Jimmy Carter Blvd", lat: 33.9, lng: -84.2,
    city: "Norcross", region: "GA", country_code: "US",
    cuisine_types: ["AFGHAN"], hero_photo_url: null, halal_profile: null,
  },
  {
    id: "fx-bosphorus", name: "Bosphorus Grill",
    address: "12 Marietta St", lat: 33.75, lng: -84.39,
    city: "Atlanta", region: "GA", country_code: "US",
    cuisine_types: ["TURKISH"],
    hero_photo_url: "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=800",
    halal_profile: profile({ dispute_state: "DISPUTED" }),
  },
];

export const FIXTURE_VERIFIER = {
  handle: "@amira.eats",
  bio: "Atlanta-based. I eat out three times a week anyway — might as well make it count.",
  visits: 12, cities: 8, since: "2024",
};

export const FIXTURE_ACTIVITY = [
  { icon: "check", title: "Your report was upheld", body: "Bosphorus Grill's alcohol policy was corrected. The public profile is updated.", when: "2H AGO · DISPUTE", unread: true },
  { icon: "shield", title: "A place you saved is now Verified", body: "Al-Noor Shawarma passed an in-person verifier visit.", when: "YESTERDAY · SAVED", unread: true },
  { icon: "clock", title: "Owner is responding to your report", body: "Saffron Yemeni Kitchen — certificate expiry question.", when: "MAY 8 · DISPUTE", unread: false },
] as const;
