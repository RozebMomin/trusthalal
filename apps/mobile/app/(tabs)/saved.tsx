import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useMyFavorites, useToggleFavorite } from "@/lib/api/hooks";
import { primaryHalalSignal } from "@/lib/halal-display";
import type { PlaceSearchResult } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Chip, Tag } from "@/ui/kit";
import { EmptyState, ErrorState, Loading } from "@/components/States";

const TONE = { positive: "solid", trusted: "amber", neutral: "zinc", muted: "dashed", warning: "danger" } as const;

/** Mockup 5: title + sync chip, city filter chips, compact photo rows
 *  with a filled red heart to unsave. */
export default function Saved() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const favorites = useMyFavorites(Boolean(me));
  const toggle = useToggleFavorite();
  const [city, setCity] = useState<string | null>(null);

  const all = favorites.data ?? [];
  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of all) counts.set(f.place.city ?? "Elsewhere", (counts.get(f.place.city ?? "Elsewhere") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const rows = city ? all.filter((f) => (f.place.city ?? "Elsewhere") === city) : all;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg }}>
        <Text style={[ty.title, { color: t.ink }]}>Saved</Text>
        {me ? (
          <Chip ghost label={favorites.isFetching ? "Syncing…" : "Up to date"} />
        ) : null}
      </View>

      {me && all.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: space.lg, marginTop: space.sm, flexWrap: "wrap" }}>
          <Chip label={`All · ${all.length}`} on={city === null} onPress={() => setCity(null)} />
          {cities.map(([c, n]) => (
            <Chip key={c} label={`${c} · ${n}`} on={city === c} onPress={() => setCity(city === c ? null : c)} />
          ))}
        </View>
      ) : null}

      {meLoading ? (
        <Loading />
      ) : !me ? (
        <EmptyState
          title="Keep a list you can trust"
          body="Save places and take your list with you. Sign in or create a free account to start saving."
          actionTitle="Sign in"
          onAction={() => router.push("/(auth)/sign-in")}
        />
      ) : favorites.isLoading ? (
        <Loading />
      ) : favorites.error ? (
        <ErrorState message="We couldn't load your saved places." onRetry={() => favorites.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing saved yet" body="Tap the heart on any restaurant and it'll be waiting for you here." />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(f) => f.place.id}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 110 }}
          renderItem={({ item }) => (
            <SavedRow
              place={item.place}
              onUnsave={() => toggle.mutate({ placeId: item.place.id, saved: true })}
            />
          )}
        />
      )}
    </View>
  );
}

function SavedRow({ place, onUnsave }: { place: PlaceSearchResult; onUnsave: () => void }) {
  const t = useTheme();
  const signal = primaryHalalSignal(place.halal_profile);
  const meta = [place.cuisine_types[0] && titleCase(place.cuisine_types[0]), place.city].filter(Boolean).join(" · ");
  return (
    <Pressable onPress={() => router.push(`/places/${place.id}`)} accessibilityRole="button" accessibilityLabel={place.name}>
      <Card style={{ flexDirection: "row", alignItems: "stretch" }}>
        {place.hero_photo_url ? (
          <Image source={{ uri: place.hero_photo_url }} style={{ width: 92 }} resizeMode="cover" />
        ) : (
          <View style={{ width: 92, backgroundColor: t.zincSoft }} />
        )}
        <View style={{ flex: 1, padding: space.md, gap: 5 }}>
          <Tag label={signal.label} tone={TONE[signal.tone]} />
          <Text numberOfLines={1} style={[ty.label, { color: t.ink, fontSize: 14 }]}>{place.name}</Text>
          {meta ? <Text style={[ty.small, { color: t.sub }]}>{meta}</Text> : null}
        </View>
        <Pressable
          accessibilityLabel={`Unsave ${place.name}`}
          onPress={onUnsave}
          hitSlop={10}
          style={{ padding: space.md, justifyContent: "flex-start" }}
        >
          <Ionicons name="heart" size={18} color={t.danger} />
        </Pressable>
      </Card>
    </Pressable>
  );
}

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
}
