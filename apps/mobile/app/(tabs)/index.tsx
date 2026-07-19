import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useCurrentUser, useMyPreferences, useReverseGeocode, useSearchDiagnostics, useSearchPlaces } from "@/lib/api/hooks";
import type { ConsumerPreferences } from "@/lib/api/types";
import type { PlaceSearchResult } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { PlaceCard } from "@/components/PlaceCard";
import { countFilters, FiltersSheet, type Filters } from "@/components/FiltersSheet";
import { LocationSheet, type PickedLocation } from "@/components/LocationSheet";
import { capture } from "@/lib/analytics";
import { MapResults } from "@/components/MapResults";
import { EmptyState, ErrorState, Loading } from "@/components/States";
import { FILTER_LABELS } from "@/lib/filter-labels";

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

/** Saved preferences → the Explore filter shape. Null/false means "no
 *  preference", so only truthy values become active filters. */
function prefsToFilters(p: ConsumerPreferences): Filters {
  const f: Filters = {};
  if (p.min_validation_tier) f.min_validation_tier = p.min_validation_tier;
  if (p.min_menu_posture) f.min_menu_posture = p.min_menu_posture;
  if (p.no_pork) f.no_pork = true;
  if (p.no_alcohol_served) f.no_alcohol_served = true;
  if (p.has_certification) f.has_certification = true;
  return f;
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
    capture("map_list_toggled", { to: next });
    Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setView(next);
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }
  const [manualLabel, setManualLabel] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  // --- Saved search defaults ------------------------------------------------
  // Seed the filter state from the diner's saved preferences ONCE per mount.
  // Deliberately a one-shot seed rather than a merge on every render: if we
  // re-applied prefs continuously, clearing a preference-derived filter would
  // snap right back (the exact bug we hit on the web surface). After the seed,
  // whatever the user does here wins for the session.
  const { data: me } = useCurrentUser();
  const savedPrefs = useMyPreferences(Boolean(me));
  const seededPrefs = useRef(false);
  const [prefsApplied, setPrefsApplied] = useState(false);

  useEffect(() => {
    if (seededPrefs.current || !savedPrefs.data) return;
    seededPrefs.current = true;
    const seed = prefsToFilters(savedPrefs.data);
    if (Object.keys(seed).length > 0) {
      setFilters(seed);
      setPrefsApplied(true);
    }
  }, [savedPrefs.data]);

  /** Any user-driven filter change takes over from the saved defaults. */
  const changeFilters: typeof setFilters = (next) => {
    setPrefsApplied(false);
    setFilters(next);
  };

  const geo = coords
    ? { lat: coords.lat, lng: coords.lng, radius: radiusMi * M_PER_MI }
    : {};
  // Named so the diagnostics query can ask about exactly the search that
  // returned nothing — rebuilding the object separately is how the two
  // drift and the explanation stops matching the result.
  const searchParams = { q: q || undefined, ...geo, ...filters, cuisines: cuisines.length ? cuisines : undefined };
  const search = useSearchPlaces(searchParams);
  const city = useReverseGeocode(coords?.lat, coords?.lng);

  // Fire on the debounced text query so we capture intentional searches
  // (not the geo auto-search on load).
  useEffect(() => {
    if (q) capture("search_performed", { query_len: q.length, filter_count: countFilters(filters), cuisine_count: cuisines.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

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

  // Auto-locate on first load so results appear without tapping "Near me".
  // Silent when permission is already granted (e.g. from onboarding), prompts
  // once when undetermined, and skips denied users (so they aren't nagged with
  // an error every load — they can still pick a city). Won't override a
  // manually chosen city.
  useEffect(() => {
    (async () => {
      if (coords || manualLabel) return;
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "denied") locate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Only asked once the search already came back empty — several COUNT
  // queries, and no reason to pay for them on a search that worked.
  const WIDER_RADIUS_M = 40234; // 25 mi
  const diagnostics = useSearchDiagnostics(searchParams, {
    enabled: Boolean(search.data && search.data.length === 0),
    widerRadiusM: coords && radiusMi < 25 ? WIDER_RADIUS_M : undefined,
  });

  const hasActiveSearch = Boolean(q) || coords !== null;
  const cityLabel = manualLabel
    ?? (city.data?.city
      ? `${city.data.city}${city.data.region ? `, ${city.data.region}` : ""}`
      : "you");

  // Result count for the map's floating bar — pluralized, with the radius
  // when it's a geo search. Undefined when there's nothing to count.
  const countLabel =
    results.length > 0
      ? coords
        ? `${results.length} ${results.length === 1 ? "spot" : "spots"} within ${radiusMi} mi`
        : `${results.length} ${results.length === 1 ? "spot" : "spots"}`
      : undefined;

  // Map view owns all of its states — cold-start, loading, empty, error,
  // and results — so it never drops back to the list layout.
  const mapMode = view === "map";

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
            active={!!filters.open_now}
            label="Open now"
            onPress={() =>
              changeFilters((f) => ({ ...f, open_now: f.open_now ? undefined : true }))
            }
          />
          <Chip
            active={filters.min_validation_tier === "TRUST_HALAL_VERIFIED"}
            label="✓ Verified"
            onPress={() =>
              changeFilters((f) => ({
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

        {/* Saved-defaults hint. Shown only while the seeded filters are still
            untouched, so the diner knows *why* results are narrowed and can
            widen them in one tap without hunting through the sheet. */}
        {prefsApplied ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="sliders" size={12} color={t.sub} />
            <Text style={[ty.small, { color: t.sub, flex: 1 }]}>
              Using your saved search defaults.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search without my saved defaults"
              onPress={() => changeFilters({})}
              hitSlop={8}
            >
              <Text style={[ty.small, { color: t.accentDeep, fontWeight: "700" }]}>
                Show all
              </Text>
            </Pressable>
          </View>
        ) : null}

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
      {view === "map" ? (
        <MapResults
          results={results}
          center={coords}
          cityLabel={
            !hasActiveSearch
              ? "Set your location"
              : coords
                ? cityLabel === "you"
                  ? "Showing places near you"
                  : `Near ${cityLabel}`
                : q
                  ? `Results for “${q}”`
                  : "Search results"
          }
          countLabel={countLabel}
          onRecenter={locate}
          onList={() => toggleView("list")}
          onLocation={() => setLocOpen(true)}
          onFilters={() => setFiltersOpen(true)}
          filterCount={countFilters(filters)}
          radiusMi={coords ? radiusMi : undefined}
          onRadius={coords ? setRadiusMi : undefined}
          onClearFilters={
            countFilters(filters) > 0 || cuisines.length > 0 || q
              ? () => { changeFilters({}); setCuisines([]); setRawQuery(""); }
              : undefined
          }
          coldStart={!hasActiveSearch}
          onLocate={locate}
          loading={hasActiveSearch && search.isLoading}
          error={!!search.error}
          onRetry={() => search.refetch()}
        />
      ) : !hasActiveSearch ? (
        <EmptyState
          title="Find halal food near you"
          body="Tap Near me, or search a restaurant by name. Every result wears its level of proof."
          actionTitle="Near me"
          onAction={locate}
        />
      ) : search.error ? (
        <ErrorState
          message="We couldn't reach Trust Halal. Check your connection."
          onRetry={() => search.refetch()}
        />
      ) : search.isLoading ? (
        <Loading />
      ) : results.length === 0 ? (
        // Says WHICH filter is responsible rather than "fewer filters" —
        // on a catalogue this size most empty searches are one filter away
        // from something, and making the person guess which of six was the
        // problem is the difference between a next step and a dead end.
        //
        // Never offers near-miss restaurants. Someone who filtered out
        // alcohol or non-zabihah meat isn't looking for places that almost
        // qualify; those aren't close enough, they're food they can't eat.
        <EmptyState
          title="Nothing matched"
          body={
            diagnostics.data?.total_in_area === 0
              ? "We don't have any restaurants here yet — coverage grows city by city. Try a wider radius or another city."
              : (diagnostics.data?.single_filter_relaxations.length ?? 0) > 0
                ? "Your filters are narrower than what's here. Loosening one would help:"
                : (diagnostics.data?.without_halal_filters ?? 0) > 0
                  ? `Your filters rule out everything nearby. ${diagnostics.data?.without_halal_filters} restaurant${diagnostics.data?.without_halal_filters === 1 ? "" : "s"} in range don't meet them.`
                  : "Coverage grows city by city. Try a wider radius, a different city, or fewer filters."
          }
          actionTitle={
            coords && radiusMi < 25 && (diagnostics.data?.wider_radius_count ?? 0) > 0
              ? `Widen to 25 mi (${diagnostics.data?.wider_radius_count})`
              : undefined
          }
          onAction={
            coords && radiusMi < 25 && (diagnostics.data?.wider_radius_count ?? 0) > 0
              ? () => setRadiusMi(25)
              : undefined
          }
          secondaryActions={[
            // One action per filter that is individually responsible, each
            // carrying what it would gain so the choice is informed.
            ...(diagnostics.data?.single_filter_relaxations ?? [])
              .slice(0, 2)
              .map((r) => ({
                title: `Drop ${FILTER_LABELS[r.field] ?? r.field} (${r.count_if_removed})`,
                onPress: () => changeFilters({ ...filters, [r.field]: undefined }),
              })),
            { title: "Change city", onPress: () => setLocOpen(true) },
            ...(countFilters(filters) > 0 || cuisines.length > 0 || q
              ? [{
                  title: "Clear filters",
                  onPress: () => { changeFilters({}); setCuisines([]); setRawQuery(""); },
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
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.place.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 110 }}
          renderItem={({ item }) => (
            <PlaceCard
              place={item.place}
              distanceMeters={item.distanceMeters}
              showUnknownHours={!!filters.open_now}
            />
          )}
        />
      )}
      </Animated.View>
      <LocationSheet
        visible={locOpen}
        onClose={() => setLocOpen(false)}
        onUseMyLocation={locate}
        onPick={(loc: PickedLocation) => {
          capture("location_changed", { label: loc.label, source: "picker" });
          setManualLabel(loc.label);
          setCoords({ lat: loc.lat, lng: loc.lng });
        }}
      />
      <FiltersSheet
        visible={filtersOpen}
        onClose={() => {
          if (countFilters(filters) > 0) capture("filters_applied", { count: countFilters(filters), ...filters });
          setFiltersOpen(false);
        }}
        filters={filters}
        onChange={changeFilters}
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
