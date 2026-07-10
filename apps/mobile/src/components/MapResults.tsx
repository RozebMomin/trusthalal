import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Dimensions, FlatList, Pressable, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { primaryHalalSignal } from "@/lib/halal-display";
import type { PlaceSearchResult } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Tag } from "@/ui/kit";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W - 72;
const TONE = { positive: "solid", trusted: "amber", neutral: "zinc", muted: "dashed", warning: "danger" } as const;

function pinColor(p: PlaceSearchResult, t: ReturnType<typeof useTheme>) {
  const s = primaryHalalSignal(p.halal_profile);
  if (s.tone === "positive") return t.accent;
  if (s.tone === "trusted") return "#F59E0B";
  if (s.tone === "warning") return t.danger;
  return "#A1A1AA";
}

/** Mockup 2: tier-colored pins + snapping bottom carousel. Tapping a
 *  pin scrolls the carousel; swiping the carousel pans the map. */
export function MapResults({
  results,
  center,
  onRecenter,
}: {
  results: Array<{ place: PlaceSearchResult; distanceMeters?: number }>;
  center: { lat: number; lng: number } | null;
  onRecenter: () => void;
}) {
  const t = useTheme();
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList>(null);
  const [selected, setSelected] = useState(0);

  const initialRegion = useMemo(() => {
    const c = center ?? (results[0] ? { lat: results[0].place.lat, lng: results[0].place.lng } : { lat: 39.5, lng: -98.35 });
    return { latitude: c.lat, longitude: c.lng, latitudeDelta: 0.12, longitudeDelta: 0.12 };
  }, [center, results]);

  const focus = (i: number, fromMap: boolean) => {
    setSelected(i);
    const p = results[i]?.place;
    if (!p) return;
    mapRef.current?.animateToRegion(
      { latitude: p.lat, longitude: p.lng, latitudeDelta: 0.045, longitudeDelta: 0.045 },
      350,
    );
    if (fromMap) listRef.current?.scrollToIndex({ index: i, animated: true });
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsUserLocation
        showsCompass={false}
        toolbarEnabled={false}
      >
        {results.map(({ place }, i) => (
          <Marker
            key={place.id}
            coordinate={{ latitude: place.lat, longitude: place.lng }}
            onPress={() => focus(i, true)}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View
              style={{
                width: i === selected ? 34 : 24,
                height: i === selected ? 34 : 24,
                borderRadius: 999,
                backgroundColor: pinColor(place, t),
                borderWidth: 3,
                borderColor: "#fff",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOpacity: 0.25,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 3 },
                elevation: 5,
              }}
            >
              {primaryHalalSignal(place.halal_profile).tone === "positive" ? (
                <Feather name="check" size={i === selected ? 15 : 11} color={t.onAccent} />
              ) : null}
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Recenter */}
      <Pressable
        accessibilityLabel="Recenter on my location"
        onPress={onRecenter}
        style={{
          position: "absolute", right: space.lg, bottom: 210,
          width: 40, height: 40, borderRadius: 999, backgroundColor: t.card,
          alignItems: "center", justifyContent: "center",
          shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 5,
        }}
      >
        <Feather name="navigation" size={16} color={t.ink} />
      </Pressable>

      {/* Snap carousel above the pill nav */}
      <FlatList
        ref={listRef}
        horizontal
        data={results}
        keyExtractor={(r) => r.place.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + 12}
        decelerationRate="fast"
        getItemLayout={(_, i) => ({ length: CARD_W + 12, offset: (CARD_W + 12) * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 12));
          if (i !== selected) focus(Math.max(0, Math.min(i, results.length - 1)), false);
        }}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: 12 }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 100 }}
        renderItem={({ item }) => {
          const signal = primaryHalalSignal(item.place.halal_profile);
          const mi = item.distanceMeters !== undefined ? `${(item.distanceMeters / 1609.34).toFixed(1)} mi` : null;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.place.name}
              onPress={() => router.push(`/places/${item.place.id}`)}
              style={{
                width: CARD_W, backgroundColor: t.card, borderRadius: radii.xl, padding: space.lg,
                shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
                gap: 5,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <Text numberOfLines={1} style={[ty.label, { color: t.ink, fontSize: 14.5, flex: 1 }]}>
                  {item.place.name}
                </Text>
                <Tag label={signal.label} tone={TONE[signal.tone]} />
              </View>
              <Text style={[ty.small, { color: t.sub }]}>
                {[mi, item.place.cuisine_types[0] && titleCase(item.place.cuisine_types[0]), item.place.city].filter(Boolean).join(" · ")}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function titleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
}
