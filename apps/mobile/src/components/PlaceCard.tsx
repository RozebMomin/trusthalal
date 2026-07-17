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
  const openState =
    place.open_now === true ? "open" : place.open_now === false ? "closed" : null;
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
            <Text style={[ty.small, { color: t.sub, marginTop: 3 }]} numberOfLines={1}>
              {openState === "open" ? (
                <Text style={{ color: "#16A34A", fontFamily: "Inter_700Bold" }}>Open</Text>
              ) : openState === "closed" ? (
                <Text style={{ color: t.sub }}>Closed</Text>
              ) : null}
              {openState ? " · " : null}
              {place.google_rating != null ? (
                <Text style={{ color: "#F59E0B", fontFamily: "Inter_700Bold" }}>
                  {`★ ${place.google_rating.toFixed(1)}`}
                </Text>
              ) : null}
              {place.google_rating != null && (dist || meta) ? " · " : null}
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
          <TierTag signal={signal} onPhoto />
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
          {openState ? (
            <View
              style={{
                alignSelf: "flex-start",
                backgroundColor:
                  openState === "open" ? "rgba(22,163,74,0.95)" : "rgba(0,0,0,0.55)",
                borderRadius: 6,
                paddingHorizontal: 7,
                paddingVertical: 2.5,
                marginBottom: 5,
              }}
            >
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 9.5, color: "#fff" }}>
                {openState === "open" ? "Open now" : "Closed"}
              </Text>
            </View>
          ) : null}
          <Text numberOfLines={1} style={[ty.label, { color: "#fff", fontSize: 16 }]}>
            {place.name}
          </Text>
          {place.google_rating != null || meta ? (
            <Text style={[ty.small, { color: "rgba(255,255,255,0.85)" }]} numberOfLines={1}>
              {place.google_rating != null ? (
                <Text style={{ color: "#FCD34D", fontFamily: "Inter_700Bold" }}>
                  {`★ ${place.google_rating.toFixed(1)}`}
                </Text>
              ) : null}
              {place.google_rating != null && meta ? " · " : null}
              {meta}
            </Text>
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
