import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, FlatList, Image, Pressable, Text, View } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { primaryHalalSignal } from "@/lib/halal-display";
import type { PlaceSearchResult } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Tag } from "@/ui/kit";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W - 72;
const TONE = { positive: "solid", trusted: "amber", neutral: "zinc", muted: "dashed", warning: "danger" } as const;
const RADII_MI = [1, 3, 5, 10, 25] as const;
const M_PER_MI = 1609.34;

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
  radiusMi,
  onRadius,
  onClearFilters,
  loading,
  coldStart,
  onLocate,
  error,
  onRetry,
}: {
  results: Array<{ place: PlaceSearchResult; distanceMeters?: number }>;
  center: { lat: number; lng: number } | null;
  cityLabel: string;
  onRecenter: () => void;
  onList: () => void;
  onLocation: () => void;
  /** Active radius in miles; undefined for text-only searches (no
   *  radius pill, no circle). */
  radiusMi?: number;
  onRadius?: (mi: number) => void;
  /** Provided only when filters/cuisines/query are active — shows a
   *  "Clear filters" action in the empty state. */
  onClearFilters?: () => void;
  /** True while a search is in flight — shows a loading pill and
   *  suppresses the empty state so the map never flashes to the list. */
  loading?: boolean;
  /** No search yet (no query, no location) — shows the "Near me" prompt
   *  over the map instead of the empty/loading overlays. */
  coldStart?: boolean;
  onLocate?: () => void;
  /** Search failed — shows a retry card over the map instead of dropping
   *  back to the list error screen. */
  error?: boolean;
  onRetry?: () => void;
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

  const fitAll = () => {
    const pts = results.map(({ place }) => ({ latitude: place.lat, longitude: place.lng }));
    if (center) pts.push({ latitude: center.lat, longitude: center.lng });
    if (pts.length === 0) return;
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: 140, bottom: 260, left: 70, right: 70 },
      animated: true,
    });
  };

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
        onMapReady={fitAll}
      >
        {center && radiusMi ? (
          <Circle
            center={{ latitude: center.lat, longitude: center.lng }}
            radius={radiusMi * M_PER_MI}
            strokeColor="rgba(14,159,110,0.65)"
            strokeWidth={1.5}
            fillColor="rgba(14,159,110,0.07)"
          />
        ) : null}
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

      {/* Floating radius pill (only for geo searches) */}
      {radiusMi && onRadius ? (
        <View
          style={{
            position: "absolute", top: insets.top + 64, left: space.lg, right: space.lg,
            flexDirection: "row", backgroundColor: t.card, borderRadius: 999, padding: 3,
            shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
          }}
        >
          {RADII_MI.map((r) => {
            const on = r === radiusMi;
            return (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityLabel={`Search within ${r} miles`}
                onPress={() => onRadius(r)}
                style={{
                  flex: 1, paddingVertical: 7, borderRadius: 999, alignItems: "center",
                  backgroundColor: on ? t.ink : "transparent",
                }}
              >
                <Text style={{ fontFamily: on ? "Inter_700Bold" : "Inter_600SemiBold", fontSize: 11, color: on ? t.onInk : t.sub }}>
                  {r} mi
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Overview: zoom out to fit every pin */}
      <Pressable
        accessibilityLabel="Show all results"
        onPress={fitAll}
        style={{
          position: "absolute", right: space.lg, bottom: 264,
          width: 40, height: 40, borderRadius: 999, backgroundColor: t.card,
          alignItems: "center", justifyContent: "center",
          shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 5,
        }}
      >
        <Feather name="maximize-2" size={15} color={t.ink} />
      </Pressable>

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

      {/* Error — retry over the map instead of the list error screen. */}
      {error ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl }}
        >
          <View
            style={{
              backgroundColor: t.card, borderRadius: radii.xl, paddingVertical: space.xl, paddingHorizontal: space.xl,
              alignItems: "center", gap: 8, maxWidth: 320,
              shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 8,
            }}
          >
            <View style={{ width: 48, height: 48, borderRadius: 999, backgroundColor: t.dangerSoft, alignItems: "center", justifyContent: "center" }}>
              <Feather name="wifi-off" size={20} color={t.danger} />
            </View>
            <Text style={[ty.label, { color: t.ink, fontSize: 16, textAlign: "center" }]}>Couldn&apos;t reach Trust Halal</Text>
            <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>Check your connection and try again.</Text>
            {onRetry ? (
              <Pressable onPress={onRetry} style={{ marginTop: 6, backgroundColor: t.ink, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11 }}>
                <Text style={{ color: t.onInk, fontFamily: "Inter_700Bold", fontSize: 13 }}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Cold start — no search yet: prompt to locate, over the map. */}
      {coldStart && !error ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl }}
        >
          <View
            style={{
              backgroundColor: t.card, borderRadius: radii.xl, paddingVertical: space.xl, paddingHorizontal: space.xl,
              alignItems: "center", gap: 8, maxWidth: 320,
              shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 8,
            }}
          >
            <View style={{ width: 48, height: 48, borderRadius: 999, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
              <Feather name="navigation" size={20} color={t.accent} />
            </View>
            <Text style={[ty.label, { color: t.ink, fontSize: 16, textAlign: "center" }]}>Halal food near you</Text>
            <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>Turn on location to see verified spots around you.</Text>
            {onLocate ? (
              <Pressable onPress={onLocate} style={{ marginTop: 6, backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11 }}>
                <Text style={{ color: t.onAccent, fontFamily: "Inter_700Bold", fontSize: 13 }}>Near me</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onLocation} style={{ paddingVertical: 6 }}>
              <Text style={[ty.small, { color: t.sub }]}>or pick a city</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Loading pill — stays on the map while a search is in flight. */}
      {loading && !coldStart && !error ? (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11,
              shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
            }}
          >
            <ActivityIndicator size="small" color={t.accent} />
            <Text style={[ty.small, { color: t.ink, fontFamily: "Inter_600SemiBold" }]}>Finding halal food nearby…</Text>
          </View>
        </View>
      ) : null}

      {/* Empty state — stays on the map (with radius pill + location + List
          all reachable) instead of bouncing to the list layout. */}
      {results.length === 0 && !loading && !coldStart && !error ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", left: space.xl, right: space.xl, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
        >
          <View
            style={{
              backgroundColor: t.card, borderRadius: radii.xl, paddingVertical: space.xl, paddingHorizontal: space.xl,
              alignItems: "center", gap: 8, maxWidth: 320,
              shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 8,
            }}
          >
            <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: t.zincSoft, alignItems: "center", justifyContent: "center" }}>
              <Feather name="map-pin" size={20} color={t.sub} />
            </View>
            <Text style={[ty.label, { color: t.ink, fontSize: 16, textAlign: "center" }]}>No halal spots in this area</Text>
            <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
              Try a wider radius{onClearFilters ? ", fewer filters," : ""} or a different city.
            </Text>
            {onClearFilters ? (
              <Pressable onPress={onClearFilters} style={{ marginTop: 6, backgroundColor: t.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}>
                <Text style={{ color: t.onInk, fontFamily: "Inter_600SemiBold", fontSize: 12.5 }}>Clear filters</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

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
