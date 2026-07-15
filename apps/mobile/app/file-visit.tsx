import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  useCurrentUser,
  useSearchPlaces,
  useSubmitVerificationVisit,
} from "@/lib/api/hooks";
import type { PlaceSearchResult, VisitDisclosure } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Seg, Steps, Tag } from "@/ui/kit";

/** Stepped "file a visit" wizard, wired to POST /me/verification-visits.
 *  Mirrors the mockup flow (docs/2026-07-06-mobile-app-mockups.html,
 *  screens 19–22): one step per decision, a progress bar up top, and a
 *  confirmation screen at the end. Steps we can back with real data:
 *    0 Place · 1 Observe · 2 Disclosure · 3 Review → 4 Submitted
 *  Photo evidence (the API supports it) joins as its own step once the
 *  camera picker ships. */

const TOTAL = 4; // decision steps; step 4 is the success screen

const DISCLOSURES: { value: VisitDisclosure; label: string }[] = [
  { value: "SELF_FUNDED", label: "I paid for it myself" },
  { value: "MEAL_COMPED", label: "The restaurant comped it" },
  { value: "PAID_PARTNERSHIP", label: "Paid partnership" },
  { value: "OTHER_DISCLOSURE", label: "Something else" },
];

function disclosureLabel(v: VisitDisclosure): string {
  return DISCLOSURES.find((d) => d.value === v)?.label ?? "";
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

  const search = useSearchPlaces({ q: selected ? "" : query.trim() });

  useEffect(() => {
    if (me === null) router.replace("/(auth)/sign-in");
    else if (me && me.role !== "VERIFIER") router.replace("/become-a-verifier");
  }, [me]);

  const field = {
    backgroundColor: t.card,
    borderRadius: radii.lg,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    color: t.ink,
    ...ty.body,
  } as const;

  const next = () => setStep((s) => Math.min(s + 1, TOTAL));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  async function onSubmit() {
    if (!selected) return;
    setError(null);
    try {
      await submit.mutateAsync({
        place_id: selected.id,
        visited_at: new Date().toISOString(),
        disclosure,
        disclosure_note:
          disclosure !== "SELF_FUNDED" && disclosureNote.trim()
            ? disclosureNote.trim()
            : undefined,
        notes_for_admin: notes.trim() || undefined,
        public_review_url: reviewUrl.trim() || undefined,
      });
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

  const results = search.data ?? [];
  const isSuccess = step === TOTAL;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          padding: space.lg,
          paddingBottom: 80,
          gap: space.md,
        }}
      >
        {/* --- Wizard chrome (hidden on the success screen) ---------------- */}
        {!isSuccess ? (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              {step === 0 ? (
                <Pressable onPress={() => router.back()} hitSlop={8}>
                  <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_700Bold" }]}>Cancel</Text>
                </Pressable>
              ) : (
                <Pressable onPress={prev} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <Feather name="chevron-left" size={16} color={t.sub} />
                  <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_700Bold" }]}>Back</Text>
                </Pressable>
              )}
              <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>
                Step {step + 1} of {TOTAL}
              </Text>
            </View>
            <Steps total={TOTAL} done={step + 1} />
          </>
        ) : null}

        {/* --- Step 0 · Place --------------------------------------------- */}
        {step === 0 ? (
          <>
            <Text style={[ty.title, { color: t.ink }]}>Where did you{"\n"}eat?</Text>
            {selected ? (
              <Card style={{ padding: space.lg, borderWidth: 2, borderColor: t.accent }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[ty.label, { color: t.ink, fontSize: 14 }]}>{selected.name}</Text>
                    <Text style={[ty.small, { color: t.sub }]}>
                      {[selected.city, selected.region].filter(Boolean).join(", ") || selected.address || ""}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setSelected(null);
                      setQuery("");
                    }}
                    hitSlop={8}
                  >
                    <Text style={[ty.label, { color: t.accentDeep, fontSize: 13 }]}>Change</Text>
                  </Pressable>
                </View>
              </Card>
            ) : (
              <>
                <TextInput
                  style={field}
                  placeholder="Search by restaurant name"
                  placeholderTextColor={t.sub}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                  autoFocus
                />
                {search.isFetching ? (
                  <View style={{ paddingVertical: 12, alignItems: "center" }}>
                    <ActivityIndicator color={t.accent} />
                  </View>
                ) : query.trim().length > 0 && results.length === 0 ? (
                  <Text style={[ty.small, { color: t.sub, paddingVertical: 6 }]}>
                    No matches. Try the exact restaurant name.
                  </Text>
                ) : (
                  results.slice(0, 6).map((p) => (
                    <Pressable key={p.id} onPress={() => setSelected(p)}>
                      <Card style={{ padding: space.lg }}>
                        <Text style={[ty.label, { color: t.ink, fontSize: 13.5 }]}>{p.name}</Text>
                        <Text style={[ty.small, { color: t.sub }]}>
                          {[p.city, p.region].filter(Boolean).join(", ") || p.address || ""}
                        </Text>
                      </Card>
                    </Pressable>
                  ))
                )}
              </>
            )}
            <Button title="Continue" onPress={next} disabled={!selected} />
          </>
        ) : null}

        {/* --- Step 1 · Observe ------------------------------------------- */}
        {step === 1 ? (
          <>
            <Text style={[ty.title, { color: t.ink }]}>What did you{"\n"}observe?</Text>
            <Text style={[ty.body, { color: t.sub }]}>
              What the reviewer should know — cert on the wall, halal menu, staff confirmed
              sourcing. Optional, but it's what your visit is worth.
            </Text>
            <Seg>Notes for the reviewer</Seg>
            <TextInput
              style={[field, { minHeight: 120, textAlignVertical: "top" }]}
              multiline
              maxLength={4000}
              placeholder="Kitchen manager showed the supplier invoice for the chicken…"
              placeholderTextColor={t.sub}
              value={notes}
              onChangeText={setNotes}
            />
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
            <Button title="Continue" onPress={next} />
          </>
        ) : null}

        {/* --- Step 2 · Disclosure ---------------------------------------- */}
        {step === 2 ? (
          <>
            <Text style={[ty.title, { color: t.ink }]}>Who paid for{"\n"}the meal?</Text>
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
                      <Text style={[ty.label, { color: on ? t.ink : t.zinc, fontSize: 13.5 }]}>{d.label}</Text>
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
            <Button title="Review & submit" onPress={next} />
          </>
        ) : null}

        {/* --- Step 3 · Review -------------------------------------------- */}
        {step === 3 ? (
          <>
            <Text style={[ty.title, { color: t.ink }]}>Review &{"\n"}submit</Text>
            <Card style={{ padding: space.lg, gap: 12 }}>
              <Row label="Restaurant" value={selected?.name ?? "—"} t={t} />
              <Row
                label="Where"
                value={
                  [selected?.city, selected?.region].filter(Boolean).join(", ") ||
                  selected?.address ||
                  "—"
                }
                t={t}
              />
              <Row label="Who paid" value={disclosureLabel(disclosure)} t={t} />
              {notes.trim() ? <Row label="Notes" value={notes.trim()} t={t} /> : null}
              {reviewUrl.trim() ? <Row label="Review link" value={reviewUrl.trim()} t={t} /> : null}
            </Card>
            <View style={{ flexDirection: "row", gap: 8, backgroundColor: t.accentSoft, borderRadius: radii.md, padding: space.md }}>
              <Feather name="shield" size={15} color={t.accentDeep} />
              <Text style={[ty.small, { color: t.accentDeep, flex: 1, fontFamily: "Inter_600SemiBold" }]}>
                Trust Halal reviews every visit. You'll be notified when it's accepted — usually
                within a few days.
              </Text>
            </View>
            {error ? <Text style={[ty.small, { color: t.danger }]}>{error}</Text> : null}
            <Button title="Submit visit" variant="accent" loading={submit.isPending} onPress={onSubmit} />
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

function Row({
  label,
  value,
  t,
}: {
  label: string;
  value: string;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[ty.seg, { color: t.sub, fontSize: 9 }]}>{label.toUpperCase()}</Text>
      <Text style={[ty.body, { color: t.ink }]}>{value}</Text>
    </View>
  );
}
