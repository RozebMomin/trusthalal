import { ImageBackground, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
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
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");

/** Mockup-1 card: edge-to-edge photo, tier tag riding top-left, glass
 *  distance chip top-right, name over a bottom scrim. Places without a
 *  photo collapse to the mockup-5 compact row. */
export function PlaceCard({
  place,
  distanceMeters,
}: {
  place: PlaceSearchResult;
  distanceMeters?: number;
}) {
  const t = useTheme();
  const signal = primaryHalalSignal(place.halal_profile);
  const dist = miles(distanceMeters);
  const meta = [...place.cuisine_types.slice(0, 2).map(titleCase), place.city]
    .filter(Boolean)
    .join(" · ");
  const open = () => router.push(`/places/${place.id}`);
  const a11y = `${place.name} — ${signal.label}`;

  if (!place.hero_photo_url) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        onPress={open}
        style={({ pressed }) => [card(t), { padding: space.lg, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[ty.label, { color: t.ink, fontSize: 15 }]}>
              {place.name}
            </Text>
            <Text style={[ty.small, { color: t.sub, marginTop: 3 }]}>
              {[dist, meta].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <TierTag signal={signal} />
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={open}
      style={({ pressed }) => [card(t), { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <ImageBackground
        source={{ uri: place.hero_photo_url }}
        style={{ height: 148, justifyContent: "flex-end" }}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.65)"]}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90 }}
        />
        <View style={{ position: "absolute", top: 10, left: 10 }}>
          <TierTag signal={signal} />
        </View>
        {dist ? (
          <View
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              backgroundColor: "rgba(255,255,255,0.92)",
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 3.5,
            }}
          >
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9.5, color: "#0B0B0E" }}>
              {dist}
            </Text>
          </View>
        ) : null}
        <View style={{ padding: space.md }}>
          <Text numberOfLines={1} style={[ty.label, { color: "#fff", fontSize: 16 }]}>
            {place.name}
          </Text>
          {meta ? (
            <Text style={[ty.small, { color: "rgba(255,255,255,0.85)" }]}>{meta}</Text>
          ) : null}
        </View>
      </ImageBackground>
    </Pressable>
  );
}

const card = (t: ReturnType<typeof useTheme>) => ({
  backgroundColor: t.card,
  borderRadius: radii.xl,
  overflow: "hidden" as const,
  shadowColor: "#000",
  shadowOpacity: 0.05,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
});
