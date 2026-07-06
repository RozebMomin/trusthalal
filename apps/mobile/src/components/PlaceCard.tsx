import { Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { primaryHalalSignal } from "@/lib/halal-display";
import type { PlaceSearchResult } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { TierTag } from "./TierTag";

function miles(m?: number) {
  if (m === undefined) return null;
  const mi = m / 1609.34;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

export function PlaceCard({
  place,
  distanceMeters,
}: {
  place: PlaceSearchResult;
  distanceMeters?: number;
}) {
  const t = useTheme();
  const signal = primaryHalalSignal(place.halal_profile);
  const meta = [
    miles(distanceMeters),
    ...place.cuisine_types.slice(0, 2).map(titleCase),
    place.city ?? undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name} — ${signal.label}`}
      onPress={() => router.push(`/places/${place.id}`)}
      style={({ pressed }) => ({
        backgroundColor: t.card,
        borderRadius: radii.xl,
        overflow: "hidden",
        transform: [{ scale: pressed ? 0.98 : 1 }],
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      })}
    >
      {place.hero_photo_url ? (
        <Image
          source={{ uri: place.hero_photo_url }}
          accessibilityLabel={place.name}
          style={{ height: 128, width: "100%" }}
          resizeMode="cover"
        />
      ) : null}
      <View style={{ padding: space.lg, gap: 6 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: space.sm,
          }}
        >
          <Text
            numberOfLines={1}
            style={[ty.label, { color: t.ink, fontSize: 16, flexShrink: 1, flex: 1 }]}
          >
            {place.name}
          </Text>
          <TierTag signal={signal} />
        </View>
        {meta ? <Text style={[ty.small, { color: t.sub }]}>{meta}</Text> : null}
      </View>
    </Pressable>
  );
}

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
}
