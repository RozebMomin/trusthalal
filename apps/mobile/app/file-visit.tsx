import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api/client";
import {
  uploadVisitAttachment,
  useCurrentUser,
  useSearchPlaces,
  useSearchSuppliers,
  useSubmitVerificationVisit,
} from "@/lib/api/hooks";
import type {
  AmenityStatus,
  PlaceSearchResult,
  VerifierMeatCheck,
  VisitDisclosure,
  VisitObservations,
} from "@/lib/api/types";
import { visitDraft } from "@/lib/visit-draft";
import { mockupPx, radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Cell, Chip, IcBox, Seg, Steps, Tag } from "@/ui/kit";
import { Mascot } from "@/components/Mascot";

/** Stepped "file a visit" wizard, wired to POST /me/verification-visits.
 *  A friendly guide (Hilal, the crescent mascot) walks the verifier through
 *  one decision per step with a progress bar up top and a thank-you at the end:
 *    0 Place · 1 Photos · 2 Order · 3 Observe · 4 Deep dive (per-meat) ·
 *    5 Amenities · 6 Disclosure · 7 Review → 8 Submitted
 *  The deep-dive step is the one that needs real hand-holding, so it's a
 *  guided add-a-meat sub-flow: pick a meat → method → items → supplier,
 *  then repeat for the next meat. */

const TOTAL = 8; // decision steps (0–7); step 8 is the success screen
const MAX_PHOTOS = 10; // matches the API's per-visit attachment cap
const M_PER_MI = 1609.34;

type VisitPhoto = { uri: string; name: string; type: string; tag?: string };

// Quick evidence labels a verifier can stick on a photo — surfaces on the
// admin review card as the attachment caption. Tap a photo to cycle.
const PHOTO_TAGS = ["Cert", "Menu", "Meal", "Other"] as const;

/** Turn an ImagePicker asset into the {uri,name,type} shape our upload
 *  helper + RN fetch expect. */
function assetToPhoto(a: ImagePicker.ImagePickerAsset): VisitPhoto {
  const uri = a.uri;
  const guessedExt = (a.fileName?.split(".").pop() || uri.split(".").pop() || "jpg").toLowerCase();
  const type = a.mimeType || (guessedExt === "png" ? "image/png" : "image/jpeg");
  const name = a.fileName || `visit-${Date.now()}.${guessedExt}`;
  return { uri, name, type };
}
const NEARBY_RADIUS_M = 10 * M_PER_MI; // suggest places within ~10 mi

function milesAway(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))) / M_PER_MI;
}

function distanceLabel(mi: number): string {
  // Within a block or so, read it as "you're here" with a feet estimate,
  // matching the mockup's "You're here · 40 ft away".
  if (mi < 0.1) return `You're here · ${Math.round((mi * 5280) / 10) * 10} ft away`;
  if (mi < 10) return `${mi.toFixed(1)} mi away`;
  return `${Math.round(mi)} mi away`;
}

const DISCLOSURES: { value: VisitDisclosure; label: string }[] = [
  { value: "SELF_FUNDED", label: "I paid for it myself" },
  { value: "MEAL_COMPED", label: "The restaurant comped it" },
  { value: "PAID_PARTNERSHIP", label: "Paid partnership" },
  { value: "OTHER_DISCLOSURE", label: "Something else" },
];


type CheckVal = "YES" | "NO" | "PARTIAL";

// The four at-a-glance observations from the mockup. `good` is the answer
// that reads as reassuring for that prompt — so the tag goes green when the
// answer matches it, red when it doesn't. e.g. "cert visible? NO" is bad
// (red), but "alcohol on premises? NO" is good (green). Free-form findings
// go in Notes; these are the quick structured signals a reviewer scans.
const CHECK_ITEMS = [
  {
    label: "Halal cert visible on premises",
    good: "YES",
    pill: { YES: "Cert sighted", NO: "No cert seen", PARTIAL: "Cert unclear" },
  },
  {
    label: "Alcohol on premises",
    good: "NO",
    pill: { YES: "Alcohol served", NO: "No alcohol", PARTIAL: "Some alcohol" },
  },
  {
    label: "Staff confirmed sourcing",
    good: "YES",
    pill: { YES: "Sourcing confirmed", NO: "Sourcing unconfirmed", PARTIAL: "Sourcing partial" },
  },
] as const satisfies readonly {
  label: string;
  good: CheckVal;
  pill: Record<CheckVal, string>;
}[];
type CheckItem = (typeof CHECK_ITEMS)[number]["label"];
const CHECK_CYCLE: (CheckVal | undefined)[] = [undefined, "YES", "NO", "PARTIAL"];

// Item-wise findings, captured with the same tap-to-cycle Tag idiom as the
// Checks card. The vocabulary is species-appropriate: chicken has the hand-cut
// vs machine-cut debate, so it records the OBSERVABLE method and lets the
// consumer decide their own zabihah standard. Beef/lamb/goat have no mechanical
// analogue — the observable question is whether staff say it's hand-slaughtered
// by a Muslim — so they use ZABIHAH / NOT_ZABIHAH. Both map onto the halal
// profile's per-meat axes one-to-one.
type Finding =
  | "HAND_CUT"
  | "MACHINE_CUT"
  | "ZABIHAH"
  | "NOT_ZABIHAH"
  | "NOT_SERVED"
  | "UNSURE";
const FINDING_LABEL: Record<Finding, string> = {
  HAND_CUT: "Hand-cut",
  MACHINE_CUT: "Machine",
  ZABIHAH: "Zabihah",
  NOT_ZABIHAH: "Not zabihah",
  NOT_SERVED: "Not served",
  UNSURE: "Unsure",
};
const SLAUGHTER_FINDINGS: Finding[] = ["HAND_CUT", "MACHINE_CUT", "NOT_SERVED", "UNSURE"];
const ZABIHAH_FINDINGS: Finding[] = ["ZABIHAH", "NOT_ZABIHAH", "NOT_SERVED", "UNSURE"];
const MEATS = [
  { v: "CHICKEN", label: "Chicken", findings: SLAUGHTER_FINDINGS },
  { v: "BEEF", label: "Beef", findings: ZABIHAH_FINDINGS },
  { v: "LAMB", label: "Lamb", findings: ZABIHAH_FINDINGS },
  { v: "GOAT", label: "Goat", findings: ZABIHAH_FINDINGS },
] as const;
type MeatKey = (typeof MEATS)[number]["v"];
const findingsFor = (m: MeatKey): Finding[] =>
  MEATS.find((x) => x.v === m)?.findings ?? SLAUGHTER_FINDINGS;

type Evidence = "VERBAL" | "INVOICE" | "CERTIFICATE";
// Conversational phrasing for the guided deep-dive chips.
const EVIDENCE_GUIDED_LABEL: Record<Evidence, string> = {
  VERBAL: "They told me",
  INVOICE: "Saw an invoice",
  CERTIFICATE: "Saw a cert",
};
const EVIDENCE_CYCLE: Evidence[] = ["VERBAL", "INVOICE", "CERTIFICATE"];

/** One entry in the guided deep-dive — a core meat or a custom "other" item,
 *  reduced to a flat config the shared card renderer consumes. */
type DeepCfg = {
  focusKey: string; // "meat:CHICKEN" | "other:0" — also the item-draft key
  label: string;
  methods: Finding[];
  finding: Finding;
  evidence: Evidence;
  items: string[];
  supplier: string;
  onFinding: (f: Finding) => void;
  onEvidence: (e: Evidence) => void;
  onAddItem: (name: string) => void;
  onRemoveItem: (name: string) => void;
  onSupplier: (name: string) => void;
  onRemove: () => void;
};

/** One meat the verifier asked about: the method they observed, how they know,
 *  the specific items it applied to (thighs, breast…), and — if staff named one
 *  — a single supplier for that meat. Items and supplier are both optional; a
 *  verifier can log "beef is zabihah, they just said so" with neither. */
type MeatCheck = { finding: Finding; evidence: Evidence; items: string[]; supplier?: string };
type OtherCheck = { label: string; finding: Finding; evidence: Evidence; items: string[]; supplier?: string };
// "Other" items (duck, fish, a specific dish) use the same observable vocab.
const OTHER_FINDINGS: Finding[] = SLAUGHTER_FINDINGS;
// The guided deep-dive offers a meat's methods minus NOT_SERVED — you only add a
// meat here because you *did* observe it, so "not served" would be contradictory.
const methodChoices = (findings: Finding[]): Finding[] => findings.filter((f) => f !== "NOT_SERVED");

// Menu coverage: Yes (fully halal) or Partial. There is no "No" — a place
// with no halal food has no reason to be on the platform; a false claim is a
// data problem handled in notes, not a menu state.
type MenuHalal = "YES" | "PARTIAL";
type MenuScope = "MEAT_GROUP" | "SPECIFIC_ITEMS" | "ON_REQUEST";
const MENU_SCOPE_LABEL: Record<MenuScope, string> = {
  MEAT_GROUP: "A meat group",
  SPECIFIC_ITEMS: "Specific dishes",
  ON_REQUEST: "On request",
};

// Family/cleanliness amenities muslim diners look for. Kept structured so they
// can become consumer filters later. Prayer space + wudu additionally offer
// "On request" — they're often not public but staff will sort you out if you
// ask; bidet / baby-changing are a plain Yes/No/Unsure.
type AmenityVal = "YES" | "ON_REQUEST" | "NO" | "UNSURE";
const AMENITY_VALS_REQUESTABLE: AmenityVal[] = ["YES", "ON_REQUEST", "NO", "UNSURE"];
const AMENITY_VALS_BASIC: AmenityVal[] = ["YES", "NO", "UNSURE"];
const AMENITIES = [
  { v: "PRAYER_SPACE", label: "Prayer space", hint: "Musalla / prayer room", vals: AMENITY_VALS_REQUESTABLE },
  { v: "WUDU", label: "Wudu area", hint: "Ablution facilities", vals: AMENITY_VALS_REQUESTABLE },
  { v: "BIDET", label: "Bidet / shattaf", hint: "In the restrooms", vals: AMENITY_VALS_BASIC },
  { v: "BABY_CHANGING", label: "Baby changing", hint: "Changing table", vals: AMENITY_VALS_BASIC },
] as const;
type AmenityKey = (typeof AMENITIES)[number]["v"];
const amenityValsFor = (k: AmenityKey): AmenityVal[] =>
  AMENITIES.find((x) => x.v === k)?.vals ?? AMENITY_VALS_BASIC;
const AMENITY_LABEL: Record<AmenityVal, string> = {
  YES: "Yes",
  ON_REQUEST: "On request",
  NO: "No",
  UNSURE: "Unsure",
};
// Present = wash (positive); on-request/unsure = amber (a caveat); absent =
// neutral zinc (not a defect).
const amenityTone = (v: AmenityVal): "wash" | "zinc" | "amber" =>
  v === "YES" ? "wash" : v === "NO" ? "zinc" : "amber";

function checkTone(v: CheckVal | undefined, good: CheckVal): "wash" | "danger" | "amber" | "zinc" {
  if (!v) return "zinc";
  if (v === "PARTIAL") return "amber";
  return v === good ? "wash" : "danger";
}

const DISCLOSURE_SHORT: Record<VisitDisclosure, string> = {
  SELF_FUNDED: "Meal self-paid",
  MEAL_COMPED: "Meal comped",
  PAID_PARTNERSHIP: "Paid partnership",
  OTHER_DISCLOSURE: "Other arrangement",
};

/** "Jul 6 · 6:40 PM" — the visit stamp shown on the report card. */
function whenLabel(d: Date): string {
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export default function FileVisit() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const submit = useSubmitVerificationVisit();

  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PlaceSearchResult | null>(null);
  const [disclosure, setDisclosure] = useState<VisitDisclosure>("SELF_FUNDED");
  const [disclosureNote, setDisclosureNote] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [ordered, setOrdered] = useState<string[]>([]);
  const [addingItem, setAddingItem] = useState(false);
  const [itemDraft, setItemDraft] = useState("");
  const [checks, setChecks] = useState<Partial<Record<CheckItem, CheckVal>>>({});
  const [menuHalal, setMenuHalal] = useState<MenuHalal | null>(null);
  const [menuScope, setMenuScope] = useState<MenuScope | null>(null);
  const [menuNote, setMenuNote] = useState("");
  const [meatChecks, setMeatChecks] = useState<Partial<Record<MeatKey, MeatCheck>>>({});
  const [otherChecks, setOtherChecks] = useState<OtherCheck[]>([]);
  const [addingOther, setAddingOther] = useState(false);
  const [otherDraft, setOtherDraft] = useState("");
  // Per-entry "add an item" text, keyed by focus key ("meat:CHICKEN" / "other:0").
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});
  const setDeepItemDraft = (key: string, v: string) => setItemDrafts((d) => ({ ...d, [key]: v }));
  const [amenities, setAmenities] = useState<Partial<Record<AmenityKey, AmenityVal>>>({});
  const [photos, setPhotos] = useState<VisitPhoto[]>([]);
  // Stamp the visit at open time — shown on the report card and sent as visited_at.
  const [visitedAt] = useState(() => new Date());

  const addPhotos = (assets: ImagePicker.ImagePickerAsset[]) =>
    setPhotos((ps) => [...ps, ...assets.map(assetToPhoto)].slice(0, MAX_PHOTOS));

  // Cycle a photo's evidence tag: none → Cert → Menu → Meal → Other → none.
  const cyclePhotoTag = (i: number) =>
    setPhotos((ps) =>
      ps.map((p, j) => {
        if (j !== i) return p;
        const idx = p.tag ? PHOTO_TAGS.indexOf(p.tag as (typeof PHOTO_TAGS)[number]) : -1;
        const next = PHOTO_TAGS[idx + 1]; // undefined when past the end → clears
        return { ...p, tag: next };
      }),
    );

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!res.canceled) addPhotos(res.assets);
  };

  const pickPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.7,
    });
    if (!res.canceled) addPhotos(res.assets);
  };

  const addItem = () => {
    const v = itemDraft.trim();
    if (v) setOrdered((xs) => (xs.includes(v) ? xs : [...xs, v]));
    setItemDraft("");
    setAddingItem(false);
  };
  const cycleCheck = (item: CheckItem) =>
    setChecks((c) => {
      const i = CHECK_CYCLE.indexOf(c[item]);
      const nextVal = CHECK_CYCLE[(i + 1) % CHECK_CYCLE.length];
      const copy = { ...c };
      if (nextVal) copy[item] = nextVal;
      else delete copy[item];
      return copy;
    });

  // --- Guided deep-dive: add a meat, then set its fields ------------------
  // Adding a meat seeds it with its first method (hand-cut / zabihah) so the
  // card opens already showing a sensible default the verifier can change.
  const addMeat = (m: MeatKey) =>
    setMeatChecks((c) =>
      c[m] ? c : { ...c, [m]: { finding: methodChoices(findingsFor(m))[0], evidence: "VERBAL", items: [] } },
    );
  const removeMeat = (m: MeatKey) =>
    setMeatChecks((c) => {
      const copy = { ...c };
      delete copy[m];
      return copy;
    });
  const setMeatFinding = (m: MeatKey, finding: Finding) =>
    setMeatChecks((c) => (c[m] ? { ...c, [m]: { ...c[m], finding } } : c));
  const setMeatEvidence = (m: MeatKey, evidence: Evidence) =>
    setMeatChecks((c) => (c[m] ? { ...c, [m]: { ...c[m], evidence } } : c));
  const setMeatSupplier = (m: MeatKey, supplier: string) =>
    setMeatChecks((c) => (c[m] ? { ...c, [m]: { ...c[m], supplier } } : c));
  const addMeatItem = (m: MeatKey, name: string) => {
    const v = name.trim();
    if (!v) return;
    setMeatChecks((c) =>
      c[m] ? { ...c, [m]: { ...c[m], items: c[m].items.includes(v) ? c[m].items : [...c[m].items, v] } } : c,
    );
  };
  const removeMeatItem = (m: MeatKey, name: string) =>
    setMeatChecks((c) => (c[m] ? { ...c, [m]: { ...c[m], items: c[m].items.filter((x) => x !== name) } } : c));

  const addOther = () => {
    const v = otherDraft.trim();
    if (v) setOtherChecks((xs) => [...xs, { label: v, finding: "HAND_CUT", evidence: "VERBAL", items: [] }]);
    setOtherDraft("");
    setAddingOther(false);
  };
  const removeOther = (i: number) =>
    setOtherChecks((xs) => xs.filter((_, j) => j !== i));
  const setOtherFinding = (i: number, finding: Finding) =>
    setOtherChecks((xs) => xs.map((o, j) => (j === i ? { ...o, finding } : o)));
  const setOtherEvidence = (i: number, evidence: Evidence) =>
    setOtherChecks((xs) => xs.map((o, j) => (j === i ? { ...o, evidence } : o)));
  const setOtherSupplier = (i: number, supplier: string) =>
    setOtherChecks((xs) => xs.map((o, j) => (j === i ? { ...o, supplier } : o)));
  const addOtherItem = (i: number, name: string) => {
    const v = name.trim();
    if (!v) return;
    setOtherChecks((xs) =>
      xs.map((o, j) => (j === i ? { ...o, items: o.items.includes(v) ? o.items : [...o.items, v] } : o)),
    );
  };
  const removeOtherItem = (i: number, name: string) =>
    setOtherChecks((xs) => xs.map((o, j) => (j === i ? { ...o, items: o.items.filter((x) => x !== name) } : o)));

  // --- Supplier autocomplete against the registry ------------------------
  // Only the focused supplier input queries + shows suggestions. Focus key is
  // "meat:<KEY>" or "other:<index>". A tap fills the canonical registry name
  // (fixing typos); free text still stands if nothing matches.
  const [supplierFocus, setSupplierFocus] = useState<string | null>(null);
  const activeSupplierText = (() => {
    if (!supplierFocus) return "";
    // Focus key: "meat:<KEY>" or "other:<idx>" — one supplier per meat now.
    const [kind, key] = supplierFocus.split(":");
    return kind === "meat"
      ? meatChecks[key as MeatKey]?.supplier ?? ""
      : otherChecks[Number(key)]?.supplier ?? "";
  })();
  const [supplierQuery, setSupplierQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSupplierQuery(activeSupplierText), 200);
    return () => clearTimeout(id);
  }, [activeSupplierText]);
  const supplierSuggest = useSearchSuppliers(supplierQuery, Boolean(supplierFocus));
  // Blur-then-tap: clear focus on a short delay so a suggestion's onPress lands
  // before the list unmounts.
  const blurSupplier = (key: string) =>
    setTimeout(() => setSupplierFocus((f) => (f === key ? null : f)), 150);
  const pickSupplier = (setter: (name: string) => void, name: string) => {
    setter(name);
    setSupplierFocus(null);
    Keyboard.dismiss();
  };
  const renderSupplierSuggestions = (focusKey: string, onPick: (name: string) => void) => {
    if (supplierFocus !== focusKey) return null;
    const q = supplierQuery.trim();
    if (q.length < 2) return null;
    const items = (supplierSuggest.data ?? []).filter(
      (s) => s.name.toLowerCase() !== q.toLowerCase(),
    );
    if (items.length === 0) return null;
    return (
      <View
        style={{
          marginTop: 2,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {items.slice(0, 6).map((s, idx) => (
          <Pressable
            key={s.id}
            onPress={() => onPick(s.name)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderTopWidth: idx === 0 ? 0 : 1,
              borderTopColor: t.line,
            }}
          >
            <MaterialCommunityIcons name="check-decagram-outline" size={mockupPx(14)} color={t.accentDeep} />
            <View style={{ flex: 1 }}>
              <Text style={[ty.small, { color: t.ink, fontSize: mockupPx(11) }]} numberOfLines={1}>
                {s.name}
              </Text>
              {s.certifying_body_name ? (
                <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(9) }]} numberOfLines={1}>
                  certified by {s.certifying_body_name}
                </Text>
              ) : null}
            </View>
            {s.city ? (
              <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(9.5) }]} numberOfLines={1}>
                {s.city}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    );
  };

  const cycleAmenity = (k: AmenityKey) =>
    setAmenities((a) => {
      // Cleared is the first stop, then this amenity's own value set (prayer
      // space + wudu include "On request"; the others don't).
      const cycle: (AmenityVal | undefined)[] = [undefined, ...amenityValsFor(k)];
      const i = cycle.indexOf(a[k]);
      const next = cycle[(i + 1) % cycle.length];
      if (!next) {
        const copy = { ...a };
        delete copy[k];
        return copy;
      }
      return { ...a, [k]: next };
    });

  // Structured observations for the API — only send when non-empty.
  const buildObservations = (): VisitObservations | undefined => {
    const hasChecks = CHECK_ITEMS.some((c) => checks[c.label]);
    const meatEntries = Object.entries(meatChecks);
    const hasMeat = meatEntries.length > 0 || otherChecks.length > 0;
    const amenityEntries = Object.entries(amenities);
    const hasAny =
      ordered.length ||
      hasChecks ||
      hasMeat ||
      menuHalal ||
      amenityEntries.length;
    if (!hasAny) return undefined;
    // Menu coverage rides along in the free-form checks map under a stable key
    // so the admin's Checks display picks it up without a bespoke field.
    const checksOut: Record<string, CheckVal> = { ...checks };
    if (menuHalal) checksOut["Menu is fully halal"] = menuHalal;
    const obs: VisitObservations = {
      ordered_items: ordered,
      checks: checksOut,
    };
    // Map internal {finding, evidence, items[], supplier} → API shape. Each
    // named item becomes a product row carrying the meat's single supplier
    // (verbal or documented — a supplier the verifier heard still counts, we
    // reconcile it to the registry later). When staff named a supplier but no
    // specific item, it rides the legacy meat-level supplier_name field so the
    // signal isn't lost.
    const applySupplier = (
      out: VerifierMeatCheck,
      items: string[],
      supplier: string | undefined,
    ) => {
      const sup = supplier?.trim() || null;
      const names = items.map((s) => s.trim()).filter(Boolean);
      if (names.length) {
        out.products = names.map((product_name) => ({ product_name, supplier_name: sup }));
      } else if (sup) {
        out.supplier_name = sup;
      }
    };
    if (meatEntries.length) {
      obs.meat_checks = Object.fromEntries(
        meatEntries.map(([k, mc]) => {
          const out: VerifierMeatCheck = { finding: mc.finding, evidence: mc.evidence };
          applySupplier(out, mc.items, mc.supplier);
          return [k, out];
        }),
      ) as Record<string, VerifierMeatCheck>;
    }
    if (otherChecks.length) {
      obs.other_meat_checks = otherChecks.map((o) => {
        const out: VerifierMeatCheck & { label: string } = {
          label: o.label,
          finding: o.finding,
          evidence: o.evidence,
        };
        applySupplier(out, o.items, o.supplier);
        return out;
      });
    }
    if (menuHalal === "PARTIAL" && menuScope) {
      obs.menu_partial = { scope: menuScope, note: menuNote.trim() || null };
    }
    if (amenityEntries.length) {
      obs.amenities = Object.fromEntries(amenityEntries) as Record<string, AmenityStatus>;
    }
    return obs;
  };

  // Scroll a just-focused low input clear of the keyboard. automaticallyAdjust
  // KeyboardInsets reveals the field's top but doesn't follow the caret as a
  // multiline note grows, so nudge the whole tail above the keyboard.
  const scrollRef = useRef<ScrollView>(null);
  const revealInput = () =>
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);

  // --- On-device draft: hydrate once, then autosave on every change -------
  const hydrated = useRef(false);
  const clearDraft = () => void visitDraft.clear();

  useEffect(() => {
    (async () => {
      const d = await visitDraft.load();
      if (d) {
        setStep(Math.min(d.step ?? 0, TOTAL - 1)); // never resume onto success
        setSelected(d.selected ?? null);
        setOrdered(d.ordered ?? []);
        setChecks(d.checks ?? {});
        setMenuHalal((d.menuHalal ?? null) as MenuHalal | null);
        setMenuScope((d.menuScope ?? null) as MenuScope | null);
        setMenuNote(d.menuNote ?? "");
        // v2 drafts store items[] + one supplier per meat directly.
        const rawMeat = (d.meatChecks ?? {}) as Record<string, MeatCheck>;
        setMeatChecks(
          Object.fromEntries(
            Object.entries(rawMeat).map(([k, mc]) => [
              k,
              { finding: mc.finding, evidence: mc.evidence, items: mc.items ?? [], supplier: mc.supplier },
            ]),
          ) as Partial<Record<MeatKey, MeatCheck>>,
        );
        const rawOther = (d.otherChecks ?? []) as OtherCheck[];
        setOtherChecks(
          rawOther.map((o) => ({
            label: o.label,
            finding: o.finding,
            evidence: o.evidence,
            items: o.items ?? [],
            supplier: o.supplier,
          })),
        );
        setAmenities((d.amenities ?? {}) as Partial<Record<AmenityKey, AmenityVal>>);
        setPhotos(d.photos ?? []);
        setDisclosure(d.disclosure ?? "SELF_FUNDED");
        setDisclosureNote(d.disclosureNote ?? "");
        setNotes(d.notes ?? "");
        setReviewUrl(d.reviewUrl ?? "");
      }
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current || step >= TOTAL) return;
    void visitDraft.save({
      step,
      selected,
      ordered,
      checks,
      menuHalal,
      menuScope,
      menuNote,
      meatChecks,
      otherChecks,
      amenities,
      photos,
      disclosure,
      disclosureNote,
      notes,
      reviewUrl,
    });
  }, [step, selected, ordered, checks, menuHalal, menuScope, menuNote, meatChecks, otherChecks, amenities, photos, disclosure, disclosureNote, notes, reviewUrl]);

  const typed = query.trim();
  // Text query wins; otherwise fall back to nearby suggestions from the
  // device location. Note: this must NOT depend on `selected` — selecting a
  // place is a UI highlight, and gating the query on it would swap the query
  // key to {} and blank the whole list.
  const search = useSearchPlaces(
    typed
      ? { q: typed }
      : coords
        ? { lat: coords.lat, lng: coords.lng, radius: NEARBY_RADIUS_M }
        : {},
  );

  useEffect(() => {
    if (me === null) router.replace("/(auth)/sign-in");
    else if (me && me.role !== "VERIFIER") router.replace("/become-a-verifier");
  }, [me]);

  // Grab the device location so step 1 can suggest places you're near.
  // Silent when permission was already granted (e.g. from Explore); we
  // only read a coarse position and never block the flow on it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        const status =
          existing.status === "granted"
            ? existing.status
            : (await Location.requestForegroundPermissionsAsync()).status;
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // Location is a nicety here — search-by-name always works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Picker rows: text-search results as-is, or nearby suggestions sorted by
  // distance (closest first) with a mileage label. Normalized to one shape.
  const suggestions = useMemo(() => {
    const rows = search.data?.pages.flat() ?? [];
    if (typed || !coords) return rows.map((p) => ({ p, mi: null as number | null }));
    return rows
      .map((p) => ({ p, mi: milesAway(coords, { lat: p.lat, lng: p.lng }) }))
      .sort((a, b) => (a.mi ?? 0) - (b.mi ?? 0));
  }, [search.data, typed, coords]);
  const showingNearby = !typed && coords !== null;

  const field = {
    backgroundColor: t.card,
    borderRadius: radii.lg,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    color: t.ink,
    ...ty.body,
    fontSize: mockupPx(13.5),
  } as const;

  // Outlined input that reads as a field when it sits on a card (where the
  // filled `field` above would blend in). Box + text match the "how you know"
  // row: same border, same ty.small / 10.5 type so the two read as a set.
  const outlinedField = {
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.ink,
    ...ty.small,
    fontSize: mockupPx(10.5),
  } as const;

  // One guided card for a meat in the deep-dive step. Written as a plain
  // function returning JSX (not a nested component) so its TextInputs keep
  // focus across keystrokes instead of remounting each render.
  const renderDeepCard = (cfg: DeepCfg) => {
    const draft = itemDrafts[cfg.focusKey] ?? "";
    const commitItem = () => {
      cfg.onAddItem(draft);
      setDeepItemDraft(cfg.focusKey, "");
    };
    return (
      <Card key={cfg.focusKey} style={{ padding: space.lg, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={[ty.label, { color: t.ink, fontSize: mockupPx(14), fontFamily: "Inter_800ExtraBold" }]}>
            {cfg.label}
          </Text>
          <Pressable onPress={cfg.onRemove} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Feather name="x" size={15} color={t.sub} />
            <Text style={{ color: t.sub, fontFamily: "Inter_600SemiBold", fontSize: mockupPx(10) }}>Remove</Text>
          </Pressable>
        </View>

        <View style={{ gap: 7 }}>
          <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10.5) }]}>
            What did staff say about the {cfg.label.toLowerCase()}?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {cfg.methods.map((f) => (
              <Chip
                key={f}
                label={FINDING_LABEL[f]}
                on={cfg.finding === f}
                accent={cfg.finding === f && f !== "UNSURE"}
                amber={cfg.finding === f && f === "UNSURE"}
                size={mockupPx(11)}
                onPress={() => cfg.onFinding(f)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: 7 }}>
          <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10.5) }]}>
            Which items? Add any they named — or skip it.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {cfg.items.map((it) => (
              <Chip key={it} label={it} on size={mockupPx(11)} onPress={() => cfg.onRemoveItem(it)} />
            ))}
            <TextInput
              style={[outlinedField, { minWidth: 120 }]}
              placeholder="e.g. thighs, wings"
              placeholderTextColor={t.sub}
              value={draft}
              onChangeText={(v) => setDeepItemDraft(cfg.focusKey, v)}
              onSubmitEditing={commitItem}
              onBlur={commitItem}
              onFocus={revealInput}
              maxLength={120}
              autoCapitalize="none"
              returnKeyType="done"
            />
          </View>
        </View>

        <View style={{ gap: 7 }}>
          <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10.5) }]}>How did you know?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {EVIDENCE_CYCLE.map((e) => (
              <Chip
                key={e}
                label={EVIDENCE_GUIDED_LABEL[e]}
                on={cfg.evidence === e}
                accent={cfg.evidence === e}
                size={mockupPx(11)}
                onPress={() => cfg.onEvidence(e)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10.5) }]}>
            Who supplies it? Optional — leave blank if they just said &ldquo;it&apos;s halal.&rdquo;
          </Text>
          <TextInput
            style={outlinedField}
            placeholder="Supplier name (e.g. Crescent Foods)"
            placeholderTextColor={t.sub}
            value={cfg.supplier}
            onChangeText={cfg.onSupplier}
            onFocus={() => {
              setSupplierFocus(cfg.focusKey);
              revealInput();
            }}
            onBlur={() => blurSupplier(cfg.focusKey)}
            maxLength={200}
            autoCapitalize="words"
          />
          {renderSupplierSuggestions(cfg.focusKey, (name) => pickSupplier(cfg.onSupplier, name))}
        </View>
      </Card>
    );
  };

  const next = () => setStep((s) => Math.min(s + 1, TOTAL));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  async function onSubmit() {
    if (!selected) return;
    setError(null);
    try {
      const visit = await submit.mutateAsync({
        place_id: selected.id,
        visited_at: visitedAt.toISOString(),
        disclosure,
        disclosure_note:
          disclosure !== "SELF_FUNDED" && disclosureNote.trim()
            ? disclosureNote.trim()
            : undefined,
        observations: buildObservations(),
        notes_for_admin: notes.trim() || undefined,
        public_review_url: reviewUrl.trim() || undefined,
      });
      // Photos stay on-device until submit, then upload to the created
      // visit. Best-effort per file — a failed photo doesn't undo a filed
      // visit; the verifier can add more from the visit later.
      for (const photo of photos) {
        try {
          await uploadVisitAttachment(visit.id, photo);
        } catch {
          // skip this file
        }
      }
      clearDraft();
      setStep(TOTAL); // → success screen
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? "You've filed a lot of visits recently — try again in an hour."
          : e instanceof ApiError
            ? e.message
            : "Something went wrong. Try again in a moment.",
      );
    }
  }

  const isSuccess = step === TOTAL;

  // A one-line-per-meat recap for the review + success cards: method, any items,
  // and a supplier if one was named.
  const meatSummary: { label: string; detail: string }[] = [
    ...MEATS.filter((m) => meatChecks[m.v]).map((m) => {
      const mc = meatChecks[m.v]!;
      const parts = [FINDING_LABEL[mc.finding]];
      if (mc.items.length) parts.push(mc.items.join(", "));
      if (mc.supplier?.trim()) parts.push(`from ${mc.supplier.trim()}`);
      return { label: m.label, detail: parts.join(" · ") };
    }),
    ...otherChecks.map((o) => {
      const parts = [FINDING_LABEL[o.finding]];
      if (o.items.length) parts.push(o.items.join(", "));
      if (o.supplier?.trim()) parts.push(`from ${o.supplier.trim()}`);
      return { label: o.label, detail: parts.join(" · ") };
    }),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Sticky header — cancel/back, step counter, progress bar stay put
          while only the step content below scrolls. */}
      {!isSuccess ? (
        <View
          style={{
            paddingTop: insets.top + space.md,
            paddingHorizontal: space.lg,
            paddingBottom: space.md,
            backgroundColor: t.bg,
            gap: space.md,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            {step === 0 ? (
              <Pressable onPress={() => router.back()} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Feather name="x" size={15} color={t.sub} />
                <Text style={[ty.body, { color: t.sub, fontFamily: "Inter_700Bold" }]}>Cancel</Text>
              </Pressable>
            ) : (
              <Pressable onPress={prev} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Feather name="chevron-left" size={16} color={t.sub} />
                <Text style={[ty.body, { color: t.sub, fontFamily: "Inter_700Bold" }]}>Back</Text>
              </Pressable>
            )}
            <Text style={[ty.body, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>
              Step {step + 1} of {TOTAL}
            </Text>
          </View>
          <Steps total={TOTAL} done={step + 1} />
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          paddingTop: isSuccess ? insets.top + space.md : space.md,
          paddingHorizontal: space.lg,
          paddingBottom: 160,
          gap: space.md,
        }}
      >
        {/* --- Step 0 · Place --------------------------------------------- */}
        {step === 0 ? (
          <>
            <Mascot
              title="Where are you eating?"
              line="Salaam! Let's start with the spot you're reviewing — search for it or pick one nearby."
            />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 9,
                backgroundColor: t.card,
                borderRadius: radii.lg,
                paddingHorizontal: space.lg,
                minHeight: 48,
              }}
            >
              <Feather name="search" size={mockupPx(15)} color={t.sub} />
              <TextInput
                style={{ flex: 1, color: t.ink, ...ty.body, fontSize: mockupPx(13.5), paddingVertical: 12 }}
                placeholder="Search by restaurant name"
                placeholderTextColor={t.sub}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
            </View>
            {showingNearby ? <Seg size={mockupPx(10)}>Near you</Seg> : null}
            {search.isFetching ? (
              <View style={{ paddingVertical: 12, alignItems: "center" }}>
                <ActivityIndicator color={t.accent} />
              </View>
            ) : typed && suggestions.length === 0 ? (
              <Text style={[ty.small, { color: t.sub, paddingVertical: 6 }]}>
                No matches. Try the exact restaurant name.
              </Text>
            ) : !typed && !coords ? (
              <Text style={[ty.small, { color: t.sub, paddingVertical: 6 }]}>
                Turn on location for nearby suggestions, or search by name.
              </Text>
            ) : (
              suggestions.slice(0, 3).map(({ p, mi }) => {
                const on = selected?.id === p.id;
                const sub =
                  mi !== null
                    ? distanceLabel(mi)
                    : [p.city, p.region].filter(Boolean).join(", ") || p.address || "";
                return (
                  <Pressable key={p.id} onPress={() => setSelected(on ? null : p)}>
                    <Card
                      style={{
                        padding: space.lg,
                        borderWidth: 2,
                        borderColor: on ? t.accent : "transparent",
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <IcBox
                          icon="map-pin"
                          bg={on ? t.accentSoft : t.zincSoft}
                          fg={on ? t.accentDeep : t.zinc}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[ty.label, { color: t.ink, fontSize: mockupPx(13), fontFamily: "Inter_700Bold" }]}>{p.name}</Text>
                          {sub ? <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10.5), marginTop: 4 }]}>{sub}</Text> : null}
                        </View>
                        {on ? (
                          <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
                            <Feather name="check" size={13} color={t.onAccent} />
                          </View>
                        ) : null}
                      </View>
                    </Card>
                  </Pressable>
                );
              })
            )}
            <Button title="Continue" onPress={next} disabled={!selected} />
          </>
        ) : null}

        {/* --- Step 1 · Photos -------------------------------------------- */}
        {step === 1 ? (
          <>
            <Mascot
              title="Snap what you saw"
              line="The cert on the wall, the menu, your plate — grab a couple and tag each one. Totally optional, but photos make a visit far stronger."
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {photos.length < MAX_PHOTOS ? (
                <Pressable
                  onPress={takePhoto}
                  style={{
                    width: 100, height: 100, borderRadius: radii.lg, backgroundColor: t.accentSoft,
                    alignItems: "center", justifyContent: "center", gap: 4,
                    borderWidth: 2, borderColor: t.accent,
                  }}
                >
                  <Feather name="camera" size={22} color={t.accentDeep} />
                  <Text style={[ty.seg, { color: t.accentDeep, fontSize: mockupPx(8.5) }]}>Camera</Text>
                </Pressable>
              ) : null}
              {photos.length < MAX_PHOTOS ? (
                <Pressable
                  onPress={pickPhotos}
                  style={{
                    width: 100, height: 100, borderRadius: radii.lg,
                    borderWidth: 1.5, borderStyle: "dashed", borderColor: t.line,
                    alignItems: "center", justifyContent: "center", gap: 4,
                  }}
                >
                  <Feather name="image" size={20} color={t.sub} />
                  <Text style={[ty.seg, { color: t.sub, fontSize: mockupPx(8.5) }]}>Library</Text>
                </Pressable>
              ) : null}
              {photos.map((p, i) => (
                // Tap the photo to cycle its evidence tag; the X removes it.
                <Pressable
                  key={p.uri + i}
                  onPress={() => cyclePhotoTag(i)}
                  style={{ width: 100, height: 100, borderRadius: radii.lg, overflow: "hidden" }}
                >
                  <Image source={{ uri: p.uri }} style={{ width: "100%", height: "100%" }} />
                  <Pressable
                    onPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                    hitSlop={6}
                    style={{
                      position: "absolute", top: 4, right: 4,
                      width: 22, height: 22, borderRadius: 999,
                      backgroundColor: "rgba(11,11,14,0.6)",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Feather name="x" size={13} color="#fff" />
                  </Pressable>
                  {/* Tag pill (or a "Tag" prompt) along the bottom edge. */}
                  <View
                    style={{
                      position: "absolute", left: 0, right: 0, bottom: 0,
                      paddingHorizontal: 6, paddingVertical: 4,
                      backgroundColor: p.tag ? t.accent : "rgba(11,11,14,0.55)",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: mockupPx(8.5), letterSpacing: 0.3 }}>
                      {p.tag ? p.tag.toUpperCase() : "TAP TO TAG"}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10) }]}>
              {photos.length > 0
                ? `${photos.length} photo${photos.length === 1 ? "" : "s"} attached · tap a photo to label it (Cert / Menu / Meal).`
                : "Aim for the cert on the wall, the menu, and what you ordered."}
            </Text>

            <Button title={photos.length ? "Continue" : "Skip for now"} onPress={next} />
            <Text style={[ty.small, { color: t.sub, textAlign: "center", fontSize: mockupPx(9.5) }]}>
              Photos stay on-device until you submit.
            </Text>
          </>
        ) : null}

        {/* --- Step 2 · Order -------------------------------------------- */}
        {step === 2 ? (
          <>
            <Mascot
              title="What did you order?"
              line="Optional — the dishes you had help us know what your visit actually covered."
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {ordered.map((item) => (
                <Chip key={item} label={item} on size={mockupPx(11)} onPress={() => setOrdered((xs) => xs.filter((x) => x !== item))} />
              ))}
              {addingItem ? (
                <TextInput
                  style={[field, { paddingVertical: 8, minWidth: 140 }]}
                  placeholder="Dish name"
                  placeholderTextColor={t.sub}
                  value={itemDraft}
                  onChangeText={setItemDraft}
                  onSubmitEditing={addItem}
                  onBlur={addItem}
                  autoFocus
                  returnKeyType="done"
                />
              ) : (
                <Chip label="+ Add a dish" ghost size={mockupPx(11)} onPress={() => setAddingItem(true)} />
              )}
            </View>
            {ordered.length ? (
              <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10) }]}>Tap a dish to remove it.</Text>
            ) : null}

            <Button title={ordered.length ? "Continue" : "Skip for now"} onPress={next} />
          </>
        ) : null}

        {/* --- Step 3 · Observe ------------------------------------------- */}
        {step === 3 ? (
          <>
            <Mascot
              title="What did you notice?"
              line="A few quick things you saw — tap through what applies. Skip any you're unsure about."
            />

            <Seg size={mockupPx(10)}>Checks</Seg>
            <Card>
              {CHECK_ITEMS.map((item, i) => (
                <Cell
                  key={item.label}
                  last={i === CHECK_ITEMS.length - 1}
                  onPress={() => cycleCheck(item.label)}
                  left={<Text style={[ty.label, { color: t.ink, fontSize: mockupPx(12.5) }]}>{item.label}</Text>}
                  right={
                    checks[item.label] ? (
                      <Tag label={checks[item.label] as string} tone={checkTone(checks[item.label], item.good)} size={mockupPx(9.5)} />
                    ) : (
                      <Tag label="TAP" tone="dashed" size={mockupPx(9.5)} />
                    )
                  }
                />
              ))}
            </Card>

            <Seg size={mockupPx(10)}>The menu</Seg>
            <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(11), marginTop: -mockupPx(2) }]}>
              Was everything halal, only a few things, or did it have to be made halal on request?
            </Text>
            {(
              [
                { key: "FULLY", label: "Fully halal", hint: "The whole menu is halal", on: menuHalal === "YES" },
                {
                  key: "SOME",
                  label: "Only some of it",
                  hint: "Certain meats or dishes are halal",
                  on: menuHalal === "PARTIAL" && menuScope !== "ON_REQUEST",
                },
                {
                  key: "REQUEST",
                  label: "Only on request",
                  hint: "You had to ask for it to be halal",
                  on: menuHalal === "PARTIAL" && menuScope === "ON_REQUEST",
                },
              ] as const
            ).map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => {
                  if (opt.key === "FULLY") {
                    setMenuHalal("YES");
                    setMenuScope(null);
                    setMenuNote("");
                  } else if (opt.key === "SOME") {
                    setMenuHalal("PARTIAL");
                    setMenuScope((s) => (s && s !== "ON_REQUEST" ? s : "SPECIFIC_ITEMS"));
                  } else {
                    setMenuHalal("PARTIAL");
                    setMenuScope("ON_REQUEST");
                  }
                }}
              >
                <Card style={{ padding: space.lg, borderWidth: opt.on ? 2 : 0, borderColor: t.accent }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ty.label, { color: opt.on ? t.ink : t.zinc, fontSize: mockupPx(13) }]}>{opt.label}</Text>
                      <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(9.5) }]}>{opt.hint}</Text>
                    </View>
                    {opt.on ? (
                      <View style={{ width: 20, height: 20, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
                        <Feather name="check" size={12} color={t.onAccent} />
                      </View>
                    ) : (
                      <View style={{ width: 20, height: 20, borderRadius: 999, borderWidth: 2, borderColor: t.line }} />
                    )}
                  </View>
                </Card>
              </Pressable>
            ))}
            {menuHalal === "PARTIAL" ? (
              <View style={{ gap: 9 }}>
                {menuScope !== "ON_REQUEST" ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {(["MEAT_GROUP", "SPECIFIC_ITEMS"] as MenuScope[]).map((s) => (
                      <Chip
                        key={s}
                        label={MENU_SCOPE_LABEL[s]}
                        on={menuScope === s}
                        size={mockupPx(11)}
                        onPress={() => setMenuScope(s)}
                      />
                    ))}
                  </View>
                ) : null}
                <TextInput
                  style={[field, { paddingVertical: 8 }]}
                  placeholder={
                    menuScope === "ON_REQUEST"
                      ? "What's made halal on request? (e.g. chicken dishes)"
                      : menuScope === "SPECIFIC_ITEMS"
                        ? "Which dishes? (e.g. wings, not the burger)"
                        : "Which meats? (e.g. all chicken is halal)"
                  }
                  placeholderTextColor={t.sub}
                  value={menuNote}
                  onChangeText={setMenuNote}
                  onFocus={revealInput}
                  maxLength={1000}
                />
              </View>
            ) : null}

            <Button title="Continue" onPress={next} />
          </>
        ) : null}

        {/* --- Step 4 · Per-meat deep dive (guided) ---------------------- */}
        {step === 4 ? (
          <>
            <Mascot
              title="Let's dive deeper"
              line="This is the important part — and I've got you. Add each meat you asked about, one at a time."
            />

            {/* Added meats, each an expanded guided card. */}
            {MEATS.filter((m) => meatChecks[m.v]).map((m) => {
              const mc = meatChecks[m.v]!;
              return renderDeepCard({
                focusKey: `meat:${m.v}`,
                label: m.label,
                methods: methodChoices(m.findings),
                finding: mc.finding,
                evidence: mc.evidence,
                items: mc.items,
                supplier: mc.supplier ?? "",
                onFinding: (f) => setMeatFinding(m.v, f),
                onEvidence: (e) => setMeatEvidence(m.v, e),
                onAddItem: (name) => addMeatItem(m.v, name),
                onRemoveItem: (name) => removeMeatItem(m.v, name),
                onSupplier: (name) => setMeatSupplier(m.v, name),
                onRemove: () => removeMeat(m.v),
              });
            })}
            {otherChecks.map((o, i) =>
              renderDeepCard({
                focusKey: `other:${i}`,
                label: o.label,
                methods: methodChoices(OTHER_FINDINGS),
                finding: o.finding,
                evidence: o.evidence,
                items: o.items,
                supplier: o.supplier ?? "",
                onFinding: (f) => setOtherFinding(i, f),
                onEvidence: (e) => setOtherEvidence(i, e),
                onAddItem: (name) => addOtherItem(i, name),
                onRemoveItem: (name) => removeOtherItem(i, name),
                onSupplier: (name) => setOtherSupplier(i, name),
                onRemove: () => removeOther(i),
              }),
            )}

            {/* Chooser — which meat to add (next). */}
            <Seg size={mockupPx(10)}>
              {Object.keys(meatChecks).length || otherChecks.length
                ? "Any other meat you asked about?"
                : "Which meat did you observe or ask about?"}
            </Seg>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {MEATS.filter((m) => !meatChecks[m.v]).map((m) => (
                <Chip key={m.v} label={`+ ${m.label}`} ghost size={mockupPx(11)} onPress={() => addMeat(m.v)} />
              ))}
              {addingOther ? (
                <TextInput
                  style={[field, { paddingVertical: 8, minWidth: 150 }]}
                  placeholder="Other (e.g. duck, fish)"
                  placeholderTextColor={t.sub}
                  value={otherDraft}
                  onChangeText={setOtherDraft}
                  onSubmitEditing={addOther}
                  onBlur={addOther}
                  autoFocus
                  returnKeyType="done"
                />
              ) : (
                <Chip label="+ Other" ghost size={mockupPx(11)} onPress={() => setAddingOther(true)} />
              )}
            </View>

            <Seg size={mockupPx(10)}>Anything else worth noting?</Seg>
            <TextInput
              style={[field, { minHeight: 100, textAlignVertical: "top" }]}
              multiline
              maxLength={4000}
              placeholder="e.g. The manager showed me the invoice for the chicken but wasn't sure about the beef."
              placeholderTextColor={t.sub}
              value={notes}
              onChangeText={setNotes}
              onFocus={revealInput}
            />

            <Button title="Continue" onPress={next} />
            <Text style={[ty.small, { color: t.sub, textAlign: "center", fontSize: mockupPx(9.5) }]}>
              Draft auto-saves on device
            </Text>
          </>
        ) : null}

        {/* --- Step 5 · Amenities (optional) ------------------------------ */}
        {step === 5 ? (
          <>
            <Mascot
              title="Anything for families?"
              line="The little things families and observant diners look for. Tap to cycle Yes / No / Unsure, or skip anything you didn't check."
            />
            <Card>
              {AMENITIES.map((a, i) => {
                const av = amenities[a.v];
                return (
                  <Cell
                    key={a.v}
                    last={i === AMENITIES.length - 1}
                    onPress={() => cycleAmenity(a.v)}
                    left={
                      <View>
                        <Text style={[ty.label, { color: t.ink, fontSize: mockupPx(12.5) }]}>{a.label}</Text>
                        <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(9.5) }]}>{a.hint}</Text>
                      </View>
                    }
                    right={
                      av ? (
                        <Tag label={AMENITY_LABEL[av]} tone={amenityTone(av)} size={mockupPx(9.5)} />
                      ) : (
                        <Tag label="TAP" tone="dashed" size={mockupPx(9.5)} />
                      )
                    }
                  />
                );
              })}
            </Card>
            <Button
              title={Object.keys(amenities).length ? "Continue" : "Skip"}
              onPress={next}
            />
          </>
        ) : null}

        {/* --- Step 6 · Disclosure ---------------------------------------- */}
        {step === 6 ? (
          <>
            <Mascot
              title="Who paid for the meal?"
              line="Last thing! Nothing here disqualifies your visit — being upfront is what keeps it trustworthy. This shows on the public report."
            />
            {DISCLOSURES.map((d) => {
              const on = disclosure === d.value;
              return (
                <Pressable key={d.value} onPress={() => setDisclosure(d.value)}>
                  <Card style={{ padding: space.lg, borderWidth: on ? 2 : 0, borderColor: t.accent }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={[ty.label, { color: on ? t.ink : t.zinc, fontSize: mockupPx(13) }]}>{d.label}</Text>
                      {on ? (
                        <View style={{ width: 20, height: 20, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
                          <Feather name="check" size={12} color={t.onAccent} />
                        </View>
                      ) : (
                        <View style={{ width: 20, height: 20, borderRadius: 999, borderWidth: 2, borderColor: t.line }} />
                      )}
                    </View>
                  </Card>
                </Pressable>
              );
            })}
            {disclosure !== "SELF_FUNDED" ? (
              <TextInput
                style={[field, { minHeight: 60, textAlignVertical: "top" }]}
                multiline
                maxLength={2000}
                placeholder="Briefly explain the arrangement (optional but helpful)."
                placeholderTextColor={t.sub}
                value={disclosureNote}
                onChangeText={setDisclosureNote}
                onFocus={revealInput}
              />
            ) : null}
            <Seg>Public review link (optional)</Seg>
            <TextInput
              style={field}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="Instagram, TikTok, or blog post about this visit"
              placeholderTextColor={t.sub}
              value={reviewUrl}
              onChangeText={setReviewUrl}
            />
            <Button title="Review & submit" onPress={next} />
          </>
        ) : null}

        {/* --- Step 7 · Review -------------------------------------------- */}
        {step === 7 ? (
          <>
            <Mascot
              title="Looks good?"
              line="Here's everything you noted. Give it a once-over, then send it our way."
            />

            {/* Report card — a preview of how this reads once accepted. */}
            <Card style={{ padding: space.lg, gap: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <Text style={[ty.label, { color: t.ink, fontSize: mockupPx(15), fontFamily: "Inter_800ExtraBold", flex: 1 }]}>
                  {selected?.name ?? "Your visit"}
                </Text>
                <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10) }]}>{whenLabel(visitedAt)}</Text>
              </View>

              {CHECK_ITEMS.some((c) => checks[c.label]) ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {CHECK_ITEMS.filter((c) => checks[c.label]).map((c) => (
                    <Tag
                      key={c.label}
                      label={c.pill[checks[c.label] as CheckVal]}
                      tone={checkTone(checks[c.label], c.good)}
                      size={mockupPx(9.5)}
                    />
                  ))}
                </View>
              ) : null}

              {ordered.length ? (
                <Text style={[ty.small, { color: t.zinc, fontSize: mockupPx(11) }]}>
                  Ordered: {ordered.join(", ")}
                </Text>
              ) : null}

              {meatSummary.length ? (
                <View style={{ gap: 4 }}>
                  {meatSummary.map((line) => (
                    <View key={line.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Feather name="check-circle" size={mockupPx(12)} color={t.accentDeep} />
                      <Text style={[ty.small, { color: t.ink, fontSize: mockupPx(11) }]}>
                        <Text style={{ fontFamily: "Inter_700Bold" }}>{line.label}:</Text> {line.detail}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {notes.trim() ? (
                <Text style={[ty.body, { color: t.ink, fontSize: mockupPx(12.5) }]} numberOfLines={3}>
                  &ldquo;{notes.trim()}&rdquo;
                </Text>
              ) : null}

              {photos.length ? (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {photos.slice(0, 3).map((p, i) => (
                    <Image
                      key={p.uri + i}
                      source={{ uri: p.uri }}
                      style={{ width: 54, height: 54, borderRadius: radii.md }}
                    />
                  ))}
                  {photos.length > 3 ? (
                    <View style={{ width: 54, height: 54, borderRadius: radii.md, backgroundColor: t.zincSoft, alignItems: "center", justifyContent: "center" }}>
                      <Text style={[ty.label, { color: t.sub, fontSize: mockupPx(11) }]}>+{photos.length - 3}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={{ height: 1, backgroundColor: t.line }} />

              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Feather name="shield" size={mockupPx(13)} color={t.accentDeep} />
                <Text style={[ty.small, { color: t.accentDeep, fontSize: mockupPx(11), fontFamily: "Inter_600SemiBold" }]}>
                  {DISCLOSURE_SHORT[disclosure]} · will be shown publicly
                </Text>
              </View>
            </Card>

            <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(11), lineHeight: mockupPx(16) }]}>
              Your report goes to Trust Halal review. If accepted, it appears on the restaurant&apos;s
              page and your public profile.
            </Text>

            {error ? <Text style={[ty.small, { color: t.danger }]}>{error}</Text> : null}

            <Button title="Submit report" variant="accent" loading={submit.isPending} onPress={onSubmit} />
            <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignItems: "center", paddingVertical: 4 }}>
              <Text style={[ty.label, { color: t.sub, fontSize: mockupPx(12) }]}>Save as draft</Text>
            </Pressable>
          </>
        ) : null}

        {/* --- Step 8 · Success ------------------------------------------- */}
        {isSuccess ? (
          <View style={{ alignItems: "center", gap: space.md, paddingTop: 32 }}>
            <Image
              source={require("../assets/mascot.png")}
              style={{ width: 120, height: 120 }}
              resizeMode="contain"
            />
            <Text style={[ty.title, { color: t.ink, textAlign: "center" }]}>Jazakallah khair!</Text>
            <Text style={[ty.body, { color: t.sub, textAlign: "center" }]}>
              Your visit is in. Trust Halal reviews every one — I'll send you a notification the
              moment it's accepted, usually within a few days.
            </Text>
            <Card style={{ padding: space.lg, alignSelf: "stretch", gap: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <Text style={[ty.label, { color: t.ink, fontSize: mockupPx(14), fontFamily: "Inter_800ExtraBold", flex: 1 }]}>
                  {selected?.name ?? "Your visit"}
                </Text>
                <Tag label="IN REVIEW" tone="amber" />
              </View>
              {meatSummary.length ? (
                <View style={{ gap: 4 }}>
                  {meatSummary.map((line) => (
                    <Text key={line.label} style={[ty.small, { color: t.sub, fontSize: mockupPx(11) }]}>
                      <Text style={{ color: t.ink, fontFamily: "Inter_700Bold" }}>{line.label}:</Text> {line.detail}
                    </Text>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {photos.length ? (
                  <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10.5) }]}>
                    {photos.length} photo{photos.length === 1 ? "" : "s"}
                  </Text>
                ) : null}
                <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10.5) }]}>
                  {DISCLOSURE_SHORT[disclosure]}
                </Text>
              </View>
            </Card>
            <View style={{ alignSelf: "stretch" }}>
              <Button title="Done" onPress={() => router.back()} />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
