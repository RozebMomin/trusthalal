import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
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
  useSubmitVerificationVisit,
} from "@/lib/api/hooks";
import type { PlaceSearchResult, VisitDisclosure } from "@/lib/api/types";
import { visitDraft } from "@/lib/visit-draft";
import { mockupPx, radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Cell, Chip, IcBox, Seg, Steps, Tag } from "@/ui/kit";

/** Stepped "file a visit" wizard, wired to POST /me/verification-visits.
 *  Mirrors the mockup flow (docs/2026-07-06-mobile-app-mockups.html,
 *  screens 19–22): one step per decision, a progress bar up top, and a
 *  confirmation screen at the end. Steps we can back with real data:
 *    0 Place · 1 Observe · 2 Disclosure · 3 Review → 4 Submitted
 *  Photo evidence (the API supports it) joins as its own step once the
 *  camera picker ships. */

const TOTAL = 5; // decision steps; step 5 is the success screen
const MAX_PHOTOS = 10; // matches the API's per-visit attachment cap
const M_PER_MI = 1609.34;

type VisitPhoto = { uri: string; name: string; type: string };

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
    label: "Menu is fully halal",
    good: "YES",
    pill: { YES: "Fully halal", NO: "Not fully halal", PARTIAL: "Partly halal" },
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
  const [photos, setPhotos] = useState<VisitPhoto[]>([]);
  // Stamp the visit at open time — shown on the report card and sent as visited_at.
  const [visitedAt] = useState(() => new Date());

  const addPhotos = (assets: ImagePicker.ImagePickerAsset[]) =>
    setPhotos((ps) => [...ps, ...assets.map(assetToPhoto)].slice(0, MAX_PHOTOS));

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

  // Structured observations for the API — only send when non-empty.
  const buildObservations = () => {
    const hasChecks = CHECK_ITEMS.some((c) => checks[c.label]);
    if (!ordered.length && !hasChecks) return undefined;
    return { ordered_items: ordered, checks: { ...checks } };
  };

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
      photos,
      disclosure,
      disclosureNote,
      notes,
      reviewUrl,
    });
  }, [step, selected, ordered, checks, photos, disclosure, disclosureNote, notes, reviewUrl]);

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
    const rows = search.data ?? [];
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg }}
    >
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
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: isSuccess ? insets.top + space.md : space.md,
          paddingHorizontal: space.lg,
          paddingBottom: 80,
          gap: space.md,
        }}
      >
        {/* --- Step 0 · Place --------------------------------------------- */}
        {step === 0 ? (
          <>
            <Text style={[ty.title, { color: t.ink, fontSize: mockupPx(21), lineHeight: mockupPx(24) }]}>
              Where are you{"\n"}eating?
            </Text>
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
            <Text style={[ty.title, { color: t.ink, fontSize: mockupPx(21), lineHeight: mockupPx(24) }]}>
              Snap it while{"\n"}you're there.
            </Text>
            <Text style={[ty.body, { color: t.sub }]}>
              Photos are your evidence — the cert on the wall, the menu, your meal. Optional, but
              a couple of good shots make a visit far stronger.
            </Text>
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
                <View key={p.uri + i} style={{ width: 100, height: 100, borderRadius: radii.lg, overflow: "hidden" }}>
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
                </View>
              ))}
            </View>
            <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10) }]}>
              {photos.length > 0
                ? `${photos.length} photo${photos.length === 1 ? "" : "s"} attached · aim for the cert, the menu, and what you ordered.`
                : "Aim for the cert on the wall, the menu, and what you ordered."}
            </Text>
            <Button title="Continue" onPress={next} />
            <Text style={[ty.small, { color: t.sub, textAlign: "center", fontSize: mockupPx(9.5) }]}>
              Photos stay on-device until you submit.
            </Text>
          </>
        ) : null}

        {/* --- Step 2 · Observe ------------------------------------------- */}
        {step === 2 ? (
          <>
            <Text style={[ty.title, { color: t.ink, fontSize: mockupPx(21), lineHeight: mockupPx(24) }]}>
              What did you{"\n"}observe?
            </Text>

            <Seg size={mockupPx(10)}>You ordered</Seg>
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
                <Chip label="+ Add item" ghost size={mockupPx(11)} onPress={() => setAddingItem(true)} />
              )}
            </View>
            <Text style={[ty.small, { color: t.sub, fontSize: mockupPx(10) }]}>Tap a dish to remove it.</Text>

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

            <Seg size={mockupPx(10)}>Notes</Seg>
            <TextInput
              style={[field, { minHeight: 110, textAlignVertical: "top" }]}
              multiline
              maxLength={4000}
              placeholder="Kitchen manager showed the supplier invoice for the chicken — Crescent Foods…"
              placeholderTextColor={t.sub}
              value={notes}
              onChangeText={setNotes}
            />

            <Button title="Continue" onPress={next} />
            <Text style={[ty.small, { color: t.sub, textAlign: "center", fontSize: mockupPx(9.5) }]}>
              Draft auto-saves on device
            </Text>
          </>
        ) : null}

        {/* --- Step 3 · Disclosure ---------------------------------------- */}
        {step === 3 ? (
          <>
            <Text style={[ty.title, { color: t.ink, fontSize: mockupPx(21), lineHeight: mockupPx(24) }]}>
              Who paid for{"\n"}the meal?
            </Text>
            <Text style={[ty.body, { color: t.sub }]}>
              Nothing here disqualifies your visit — hiding it does. This shows on the public
              report.
            </Text>
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

        {/* --- Step 4 · Review -------------------------------------------- */}
        {step === 4 ? (
          <>
            <Text style={[ty.title, { color: t.ink, fontSize: mockupPx(21), lineHeight: mockupPx(24) }]}>
              Review your{"\n"}report
            </Text>

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

        {/* --- Step 4 · Success ------------------------------------------- */}
        {isSuccess ? (
          <View style={{ alignItems: "center", gap: space.md, paddingTop: 48 }}>
            <View style={{ width: 88, height: 88, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
              <Feather name="check" size={40} color={t.onAccent} />
            </View>
            <Text style={[ty.title, { color: t.ink, textAlign: "center" }]}>Visit submitted</Text>
            <Text style={[ty.body, { color: t.sub, textAlign: "center" }]}>
              Trust Halal reviews every visit. You'll get a notification when it's accepted —
              usually within a few days.
            </Text>
            <Card style={{ padding: space.lg, alignSelf: "stretch" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>
                  {selected?.name ?? "Your visit"}
                </Text>
                <Tag label="IN REVIEW" tone="amber" />
              </View>
            </Card>
            <View style={{ alignSelf: "stretch" }}>
              <Button title="Done" onPress={() => router.back()} />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
