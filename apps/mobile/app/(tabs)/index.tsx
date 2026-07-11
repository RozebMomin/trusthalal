import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReverseGeocode, useSearchPlaces } from "@/lib/api/hooks";
import type { PlaceSearchResult } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { PlaceCard } from "@/components/PlaceCard";
import { countFilters, FiltersSheet, type Filters } from "@/components/FiltersSheet";
import { LocationSheet, type PickedLocation } from "@/components/LocationSheet";
import { MapResults } from "@/components/MapResults";
import { EmptyState, ErrorState, Loading } from "@/components/States";

const RADII_MI = [1, 3, 5, 10, 25] as const;

/** Same top-8 rail as the consumer web (cuisine-rail.tsx). */
const TOP_CUISINES = [
  { value: "PAKISTANI", label: "Pakistani" },
  { value: "INDIAN", label: "Indian" },
  { value: "MEDITERRANEAN", label: "Mediterranean" },
  { value: "LEBANESE", label: "Lebanese" },
  { value: "TURKISH", label: "Turkish" },
  { value: "YEMENI", label: "Yemeni" },
  { value: "AFGHAN", label: "Afghan" },
  { value: "AMERICAN", label: "American" },
] as const;
const M_PER_MI = 1609.34;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useMemo(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function Explore() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [rawQuery, setRawQuery] = useState("");
  const q = useDebounced(rawQuery.trim(), 250);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusMi, setRadiusMi] = useState(5);
  const [locating, setLocating] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  // List ⇄ map cross-fade: fade the whole surface out, swap layouts,
  // fade back in. Dependency-free and Fabric-safe (vs LayoutAnimation).
  const fade = useRef(new Animated.Value(1)).current;
  function toggleView(next: "list" | "map") {
    Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setView(next);
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }
  const [manualLabel, setManualLabel] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  const geo = coords
    ? { lat: coords.lat, lng: coords.lng, radius: radiusMi * M_PER_MI }
    : {};
  const search = useSearchPlaces({ q: q || undefined, ...geo, ...filters, cuisines: cuisines.length ? cuisines : undefined });
  const city = useReverseGeocode(coords?.lat, coords?.lng);

  async function locate() {
    setLocError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocError("Location is off for Trust Halal. You can still search by name.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setManualLabel(null);
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setLocError("We couldn't get your location right now. Try again in a moment.");
    } finally {
      setLocating(false);
    }
  }

  const results = useMemo<
    Array<{ place: PlaceSearchResult; distanceMeters?: number }>
  >(() => {
    const data = search.data ?? [];
    if (!coords) return data.map((place) => ({ place }));
    return data
      .map((place) => ({
        place,
        distanceMeters: haversineMeters(coords, { lat: place.lat, lng: place.lng }),
      }))
      .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  }, [search.data, coords]);

  const hasActiveSearch = Boolean(q) || coords !== null;
  const cityLabel = manualLabel
    ?? (city.data?.city
      ? `${city.data.city}${city.data.region ? `, ${city.data.region}` : ""}`
      : "you");

  const mapMode = view === "map" && hasActiveSearch && !search.isLoading && !search.error && results.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: mapMode ? 0 : insets.top + space.sm }}>
      <Animated.View style={{ flex: 1, opacity: fade }}>
      {!mapMode ? (
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        {/* Mockup-1 header: location line + filter button */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={[ty.small, { color: t.sub }]}>Finding halal food near</Text>
            <Pressable onPress={() => setLocOpen(true)} accessibilityRole="button" accessibilityLabel="Change location">
              <Text style={[ty.label, { color: t.ink, fontSize: 16 }]}>
                {coords ? cityLabel : "Anywhere"} <Text style={{ color: t.accent }}>▾</Text>
              </Text>
            </Pressable>
          </View>
          {/* Labeled pills — icon-only circles read as mystery buttons;
              "Map" and "Filters" say what they do. */}
          <View style={{ flexDirection: "row", gap: 8 }}>
          <HeaderPill
            icon={view === "list" ? "map" : "list"}
            label={view === "list" ? "Map" : "List"}
            a11y={view === "list" ? "Switch to map view" : "Switch to list view"}
            onPress={() => toggleView(view === "list" ? "map" : "list")}
          />
          <HeaderPill
            icon="sliders"
            label="Filters"
            a11y="Open filters"
            count={countFilters(filters)}
            onPress={() => setFiltersOpen(true)}
          />
          </View>
        </View>

        {/* Search field */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            backgroundColor: t.card,
            borderRadius: radii.lg,
            paddingHorizontal: space.lg,
            minHeight: 48,
          }}
        >
          <Feather name="search" size={17} color={t.sub} />
          <TextInput
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder="Search restaurants or dishes"
            placeholderTextColor={t.sub}
            accessibilityLabel="Search restaurants"
            style={[ty.body, { color: t.ink, flex: 1, paddingVertical: 12 }]}
            returnKeyType="search"
          />
          {rawQuery ? (
            <Pressable accessibilityLabel="Clear search" onPress={() => setRawQuery("")}>
              <Feather name="x" size={16} color={t.sub} />
            </Pressable>
          ) : null}
        </View>

        {/* Location pill + radius chips */}
        {/* One-line scrolling rail (mockup 1): location · verified · cuisines. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip
            active={coords !== null}
            label={locating ? "Locating you…" : coords ? cityLabel : "Set location"}
            icon="navigation"
            onPress={() => setLocOpen(true)}
          />
          <Chip
            active={filters.min_validation_tier === "TRUST_HALAL_VERIFIED"}
            label="✓ Verified"
            onPress={() =>
              setFilters((f) => ({
                ...f,
                min_validation_tier:
                  f.min_validation_tier === "TRUST_HALAL_VERIFIED" ? undefined : "TRUST_HALAL_VERIFIED",
              }))
            }
          />
          {TOP_CUISINES.map((c) => (
            <Chip
              key={c.value}
              active={cuisines.includes(c.value)}
              label={c.label}
              onPress={() =>
                setCuisines((prev) =>
                  prev.includes(c.value) ? prev.filter((x) => x !== c.value) : [...prev, c.value],
                )
              }
            />
          ))}
        </ScrollView>

        {/* Radius: one segmented control, only when location is active.
            No wrapping badge rows — pick one of five, at a glance. */}
        {coords ? (
          <View style={{ flexDirection: "row", backgroundColor: t.zincSoft, borderRadius: 14, padding: 3 }}>
            {RADII_MI.map((r) => {
              const on = r === radiusMi;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="button"
                  accessibilityLabel={`Search within ${r} miles`}
                  onPress={() => setRadiusMi(r)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 11,
                    alignItems: "center",
                    backgroundColor: on ? t.card : "transparent",
                    shadowColor: "#000",
                    shadowOpacity: on ? 0.08 : 0,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 1 },
                  }}
                >
                  <Text style={{ fontFamily: on ? "Inter_700Bold" : "Inter_600SemiBold", fontSize: 11.5, color: on ? t.ink : t.sub }}>
                    {r} mi
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {locError ? <Text style={[ty.small, { color: t.danger }]}>{locError}</Text> : null}
      </View>
      ) : null}

      {/* Results */}
      {!hasActiveSearch ? (
        <EmptyState
          title="Find halal near you"
          body="Tap Near me, or search a restaurant by name. Every result wears its level of proof."
          actionTitle="Near me"
          onAction={locate}
        />
      ) : search.isLoading ? (
        <Loading />
      ) : search.error ? (
        <ErrorState
          message="We couldn't reach Trust Halal. Check your connection."
          onRetry={() => search.refetch()}
        />
      ) : results.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Coverage grows city by city. Try a wider radius, a different city, or fewer filters."
          actionTitle={coords && radiusMi < 25 ? "Widen to 25 mi" : undefined}
          onAction={coords && radiusMi < 25 ? () => setRadiusMi(25) : undefined}
          secondaryActions={[
            { title: "Change city", onPress: () => setLocOpen(true) },
            ...(countFilters(filters) > 0 || cuisines.length > 0 || q
              ? [{
                  title: "Clear filters",
                  onPress: () => { setFilters({}); setCuisines([]); setRawQuery(""); },
                }]
              : []),
          ]}
          // TODO(wiring-plan W3/W4): re-enable once the nominate-a-restaurant
          // endpoint exists — in-app suggestion flow, not the mailto stopgap.
          // footerLink={{
          //   title: "Know a halal spot here? Suggest it",
          //   onPress: () => router.push("/suggest-a-spot"),
          // }}
        />
      ) : view === "map" ? (
        <MapResults
          results={results}
          center={coords}
          cityLabel={
            coords
              ? cityLabel === "you"
                ? "Showing places near you"
                : `Near ${cityLabel}`
              : q
                ? `Results for “${q}”`
                : "Search results"
          }
          onRecenter={locate}
          onList={() => toggleView("list")}
          onLocation={() => setLocOpen(true)}
          radiusMi={coords ? radiusMi : undefined}
          onRadius={coords ? setRadiusMi : undefined}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.place.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 110 }}
          renderItem={({ item }) => (
            <PlaceCard place={item.place} distanceMeters={item.distanceMeters} />
          )}
        />
      )}
      </Animated.View>
      <LocationSheet
        visible={locOpen}
        onClose={() => setLocOpen(false)}
        onUseMyLocation={locate}
        onPick={(loc: PickedLocation) => {
          setManualLabel(loc.label);
          setCoords({ lat: loc.lat, lng: loc.lng });
        }}
      />
      <FiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onChange={setFilters}
        resultCount={hasActiveSearch ? results.length : undefined}
      />
    </View>
  );
}

function HeaderPill({
  icon,
  label,
  a11y,
  count,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  a11y: string;
  count?: number;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: t.card,
        borderRadius: 999,
        paddingHorizontal: 13,
        minHeight: 40,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      <Feather name={icon} size={14} color={t.ink} />
      <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{label}</Text>
      {count && count > 0 ? (
        <View style={{ backgroundColor: t.accent, borderRadius: 999, minWidth: 17, height: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
          <Text style={{ color: t.onAccent, fontSize: 9.5, fontFamily: "Inter_700Bold" }}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: active ? t.ink : t.card,
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
        minHeight: 34,
      }}
    >
      {icon ? <Feather name={icon} size={12} color={active ? t.onInk : t.ink} /> : null}
      <Text
        style={{
          color: active ? t.onInk : t.ink,
          fontFamily: "Inter_600SemiBold",
          fontSize: 11.5,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
