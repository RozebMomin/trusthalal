import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import {
  useCurrentUser,
  useMyPreferences,
  useUpdateMyPreferences,
} from "@/lib/api/hooks";
import type { ConsumerPreferences, MenuPosture, ValidationTier } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Chip, ScreenHeader, Seg } from "@/ui/kit";

/**
 * Search defaults — the filters every search starts from.
 *
 * Deliberately the same vocabulary as the Filters sheet ("Any claim",
 * "Fully halal", "Pork-free"…). These are the same knobs; if the wording
 * drifted, a diner would reasonably wonder whether they're different settings.
 *
 * Saved server-side, so the defaults follow you to the web and to a new phone.
 * The Explore tab seeds its filters from these on open — and once you touch a
 * filter there, your edit wins for that session rather than getting silently
 * re-applied underneath you.
 */

const TIERS: Array<{ v: ValidationTier | undefined; label: string }> = [
  { v: undefined, label: "Any claim" },
  { v: "CERTIFICATE_ON_FILE", label: "Certified" },
  { v: "TRUST_HALAL_VERIFIED", label: "✓ Verified" },
];

const POSTURES: Array<{ v: MenuPosture; label: string }> = [
  { v: "FULLY_HALAL", label: "Fully halal" },
  { v: "MIXED_SEPARATE_KITCHENS", label: "Separate kitchen" },
  { v: "HALAL_OPTIONS_ADVERTISED", label: "Halal options" },
  { v: "HALAL_UPON_REQUEST", label: "On request" },
];

function countSet(p: ConsumerPreferences): number {
  return [
    p.min_validation_tier,
    p.min_menu_posture,
    p.no_pork,
    p.no_alcohol_served,
    p.has_certification,
  ].filter(Boolean).length;
}

export default function SearchPreferences() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const signedIn = Boolean(me);

  const prefs = useMyPreferences(signedIn);
  const save = useUpdateMyPreferences();

  // Local draft so toggling feels instant and Save is an explicit commit —
  // these change what every future search returns, so a stray tap shouldn't
  // silently persist.
  const [draft, setDraft] = useState<ConsumerPreferences>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (prefs.data && !dirty) setDraft(prefs.data);
  }, [prefs.data, dirty]);

  const set = (patch: Partial<ConsumerPreferences>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const shell = (children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          padding: space.lg,
          paddingBottom: 60,
          gap: space.md,
        }}
      >
        <ScreenHeader title="Search defaults" onBack={() => router.back()} />
        {children}
      </ScrollView>
    </View>
  );

  if (!signedIn) {
    return shell(
      <Card style={{ padding: space.lg, gap: 10 }}>
        <Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>
          Sign in to save your defaults
        </Text>
        <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
          Saved defaults follow your account, so the same filters apply on the
          web and on a new phone. You can still set filters per-search from the
          Explore tab without an account.
        </Text>
        <Button title="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
      </Card>,
    );
  }

  if (prefs.isLoading) {
    return shell(
      <View style={{ paddingVertical: 40, alignItems: "center" }}>
        <ActivityIndicator color={t.accent} />
      </View>,
    );
  }

  const setCount = countSet(draft);

  return shell(
    <>
      <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
        Every search starts from these. You can still change filters for a
        single search from the Explore tab.
      </Text>

      <Seg>Minimum proof</Seg>
      <View
        style={{
          flexDirection: "row",
          backgroundColor: t.zincSoft,
          borderRadius: radii.md,
          padding: 3,
        }}
      >
        {TIERS.map((o) => {
          const on = draft.min_validation_tier === o.v ||
            (o.v === undefined && !draft.min_validation_tier);
          return (
            <Pressable
              key={o.label}
              onPress={() => set({ min_validation_tier: o.v ?? null })}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: 11,
                backgroundColor: on ? t.card : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: on ? "Inter_700Bold" : "Inter_600SemiBold",
                  fontSize: 11,
                  color: on ? t.ink : t.sub,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[ty.small, { color: t.sub }]}>
        Verified = a Trust Halal community member ate there and confirmed it in
        person.
      </Text>

      <Seg>Menu coverage</Seg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {POSTURES.map((o) => {
          const on = draft.min_menu_posture === o.v;
          return (
            <Chip
              key={o.v}
              on={on}
              label={o.label}
              onPress={() => set({ min_menu_posture: on ? null : o.v })}
            />
          );
        })}
      </View>

      <Seg>Dietary</Seg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip
          on={!!draft.no_pork}
          label="Pork-free"
          onPress={() => set({ no_pork: draft.no_pork ? null : true })}
        />
        <Chip
          on={!!draft.no_alcohol_served}
          label="No alcohol served"
          onPress={() =>
            set({ no_alcohol_served: draft.no_alcohol_served ? null : true })
          }
        />
        <Chip
          on={!!draft.has_certification}
          label="Certificate on file"
          onPress={() =>
            set({ has_certification: draft.has_certification ? null : true })
          }
        />
      </View>

      <View style={{ marginTop: space.lg, gap: space.sm }}>
        <Button
          title={
            save.isPending
              ? "Saving…"
              : setCount > 0
                ? `Save ${setCount} default${setCount === 1 ? "" : "s"}`
                : "Save"
          }
          onPress={() => {
            save.mutate(draft, { onSuccess: () => setDirty(false) });
          }}
          disabled={save.isPending || !dirty}
        />
        {setCount > 0 ? (
          <Button
            title="Clear all defaults"
            variant="secondary"
            onPress={() => {
              setDirty(false);
              setDraft({});
              save.mutate({});
            }}
            disabled={save.isPending}
          />
        ) : null}
      </View>

      {save.isError ? (
        <Text style={[ty.small, { color: t.danger ?? "#DC2626" }]}>
          Couldn&rsquo;t save. Check your connection and try again.
        </Text>
      ) : null}

      {prefs.data?.updated_at && !dirty ? (
        <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
          Saved. These apply to new searches.
        </Text>
      ) : null}
    </>,
  );
}
