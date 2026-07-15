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
import { Card, Seg } from "@/ui/kit";

/** Real "file a visit" flow, wired to POST /me/verification-visits.
 *  Verifier picks the restaurant, discloses who paid, adds optional notes
 *  for the admin reviewer, and submits. Status starts SUBMITTED; the
 *  admin queue takes it from there. Photo evidence uploads (the API
 *  supports them) land in a follow-up once the camera picker ships. */

const DISCLOSURES: { value: VisitDisclosure; label: string }[] = [
  { value: "SELF_FUNDED", label: "I paid for it myself" },
  { value: "MEAL_COMPED", label: "The restaurant comped it" },
  { value: "PAID_PARTNERSHIP", label: "Paid partnership" },
  { value: "OTHER_DISCLOSURE", label: "Something else" },
];

export default function FileVisit() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const submit = useSubmitVerificationVisit();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PlaceSearchResult | null>(null);
  const [disclosure, setDisclosure] = useState<VisitDisclosure>("SELF_FUNDED");
  const [disclosureNote, setDisclosureNote] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Only search once a place isn't already picked and there's a query.
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
      router.replace("/verify");
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
          gap: space.sm,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Feather name="chevron-left" size={20} color={t.sub} />
          <Text style={[ty.label, { color: t.sub, fontSize: 14 }]}>Back</Text>
        </Pressable>

        <Text style={[ty.title, { color: t.ink, marginTop: 12 }]}>File a visit</Text>

        {/* Disclosure rule up front — same norm we ask on the application. */}
        <View
          style={{
            marginTop: 4,
            padding: 14,
            borderRadius: radii.xl,
            backgroundColor: t.amberSoft,
            borderWidth: 1,
            borderColor: "rgba(251,191,36,0.45)",
          }}
        >
          <Text style={[ty.body, { color: t.amber, fontSize: 14, lineHeight: 20 }]}>
            Nothing here disqualifies your visit — hiding it does. Your disclosure
            shows on the public report.
          </Text>
        </View>

        {/* --- Place picker -------------------------------------------------- */}
        <Seg style={{ marginTop: 12 }}>Where did you eat?</Seg>
        {selected ? (
          <Card style={{ padding: space.lg }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={[ty.label, { color: t.ink, fontSize: 14 }]}>{selected.name}</Text>
                <Text style={[ty.small, { color: t.sub }]}>
                  {[selected.city, selected.region].filter(Boolean).join(", ") ||
                    selected.address ||
                    ""}
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

        {/* --- Disclosure ---------------------------------------------------- */}
        <Seg style={{ marginTop: 12 }}>Who paid for the meal?</Seg>
        {DISCLOSURES.map((d) => {
          const on = disclosure === d.value;
          return (
            <Pressable key={d.value} onPress={() => setDisclosure(d.value)}>
              <Card
                style={{
                  padding: space.lg,
                  borderWidth: on ? 2 : 0,
                  borderColor: t.accent,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={[ty.label, { color: on ? t.ink : t.zinc, fontSize: 13.5 }]}>
                    {d.label}
                  </Text>
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

        {/* --- Notes + review link ------------------------------------------ */}
        <Seg style={{ marginTop: 12 }}>Notes for the reviewer (optional)</Seg>
        <TextInput
          style={[field, { minHeight: 100, textAlignVertical: "top" }]}
          multiline
          maxLength={4000}
          placeholder="What you saw — cert on the wall, halal menu, staff confirmed sourcing…"
          placeholderTextColor={t.sub}
          value={notes}
          onChangeText={setNotes}
        />

        <Seg style={{ marginTop: 12 }}>Public review link (optional)</Seg>
        <TextInput
          style={field}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="Instagram, TikTok, or blog post about this visit"
          placeholderTextColor={t.sub}
          value={reviewUrl}
          onChangeText={setReviewUrl}
        />

        {error ? (
          <Text style={[ty.small, { color: t.danger, marginTop: 4 }]}>{error}</Text>
        ) : null}

        <Button
          title="Submit visit"
          variant="accent"
          loading={submit.isPending}
          disabled={!selected}
          onPress={onSubmit}
        />
        <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
          Trust Halal reviews every visit — usually within a few days.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
