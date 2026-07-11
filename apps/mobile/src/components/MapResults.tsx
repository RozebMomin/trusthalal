import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Dimensions, FlatList, Image, Pressable, Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { primaryHalalSignal } from "@/lib/halal-display";
import type { PlaceSearchResult } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Tag } from "@/ui/kit";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W - 72;
const TONE = { positive: "solid", trusted: "amber", neutral: "zinc", muted: "dashed", warning: "danger" } as const;

/** Mockup-2 pin hierarchy: size communicates TIER (verified biggest),
 *  selection adds emphasis on top. */
function pinFor(p: PlaceSearchResult, t: ReturnType<typeof useTheme>) {
  const tone = primaryHalalSignal(p.halal_profile).tone;
  if (tone === "positive") return { size: 32, color: t.accent, check: true };
  if (tone === "trusted") return { size: 26, color: "#F59E0B", check: false };
  if (tone === "warning") return { size: 26, color: t.danger, check: false };
  return { size: 22, color: "#A1A1AA", check: false };
}

export function MapResults({
  results,
  center,
  cityLabel,
  onRecenter,
  onList,
  onLocation,
}: {
  results: Array<{ place: PlaceSearchResult; distanceMeters?: number }>;
  center: { lat: number; lng: number } | null;
  cityLabel: string;
  onRecenter: () => void;
  onList: () => void;
  onLocation: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
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
        {results.map(({ place }, i) => {
          const pin = pinFor(place, t);
          const sel = i === selected;
          const size = pin.size + (sel ? 6 : 0);
          return (
            <Marker
              key={place.id}
              coordinate={{ latitude: place.lat, longitude: place.lng }}
              onPress={() => focus(i, true)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View
                style={{
                  width: size, height: size, borderRadius: 999,
                  backgroundColor: pin.color,
                  borderWidth: 3, borderColor: "#fff",
                  alignItems: "center", justifyContent: "center",
                  shadowColor: "#000", shadowOpacity: sel ? 0.3 : 0.22,
                  shadowRadius: sel ? 8 : 5, shadowOffset: { width: 0, height: 3 },
                  elevation: sel ? 7 : 5,
                }}
              >
                {pin.check ? <Feather name="check" size={sel ? 16 : 13} color={t.onAccent} /> : null}
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Floating glass search bar (mockup 2): location label + List chip */}
      <View style={{ position: "absolute", top: insets.top + 8, left: space.lg, right: space.lg }}>
        <View
          style={{
            flexDirection: "row", alignItems: "center", gap: 9,
            backgroundColor: t.card, borderRadius: 18, paddingLeft: 14, paddingRight: 6, minHeight: 48,
            shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
          }}
        >
          <Feather name="search" size={16} color={t.sub} />
          <Pressable onPress={onLocation} accessibilityLabel="Change location" style={{ flex: 1, paddingVertical: 13 }}>
            <Text numberOfLines={1} style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold" }]}>
              {cityLabel}
            </Text>
          </Pressable>
          <Pressable
            onPress={onList}
            accessibilityLabel="List view"
            style={{ backgroundColor: t.ink, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 }}
          >
            <Text style={{ color: t.onInk, fontFamily: "Inter_600SemiBold", fontSize: 11.5 }}>List</Text>
          </Pressable>
        </View>
      </View>

      {/* Recenter */}
      <Pressable
        accessibilityLabel="Recenter on my location"
        onPress={onRecenter}
        style={{
          position: "absolute", right: space.lg, bottom: 216,
          width: 40, height: 40, borderRadius: 999, backgroundColor: t.card,
          alignItems: "center", justifyContent: "center",
          shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 5,
        }}
      >
        <Feather name="navigation" size={16} color={t.ink} />
      </Pressable>

      {/* Snap carousel: photo-thumb cards (mockup 2) */}
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
                width: CARD_W, flexDirection: "row", backgroundColor: t.card, borderRadius: radii.xl, overflow: "hidden",
                shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
              }}
            >
              {item.place.hero_photo_url ? (
                <Image source={{ uri: item.place.hero_photo_url }} style={{ width: 88 }} resizeMode="cover" />
              ) : (
                <View style={{ width: 88, backgroundColor: t.zincSoft, alignItems: "center", justifyContent: "center" }}>
                  <Feather name="image" size={16} color={t.sub} />
                </View>
              )}
              <View style={{ flex: 1, padding: space.md, gap: 4, minHeight: 88, justifyContent: "center" }}>
                <Tag mini label={signal.label} tone={TONE[signal.tone]} />
                <Text numberOfLines={1} style={[ty.label, { color: t.ink, fontSize: 14 }]}>
                  {item.place.name}
                </Text>
                <Text numberOfLines={1} style={[ty.small, { color: t.sub }]}>
                  {[mi, item.place.cuisine_types[0] && titleCase(item.place.cuisine_types[0]), item.place.city].filter(Boolean).join(" · ")}
                </Text>
              </View>
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
