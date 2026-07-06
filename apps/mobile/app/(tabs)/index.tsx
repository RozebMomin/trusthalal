import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReverseGeocode, useSearchPlaces } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { PlaceCard } from "@/components/PlaceCard";
import { EmptyState, ErrorState, Loading } from "@/components/States";

const RADII_MI = [1, 3, 5, 10, 25] as const;
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
  const [locError, setLocError] = useState<string | null>(null);

  const geo = coords
    ? { lat: coords.lat, lng: coords.lng, radius: radiusMi * M_PER_MI }
    : {};
  const search = useSearchPlaces({ q: q || undefined, ...geo });
  const city = useReverseGeocode(coords?.lat, coords?.lng);

  async function locate() {
    setLocError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocError("Location is off for HalalScout. You can still search by name.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setLocError("We couldn't get your location right now. Try again in a moment.");
    } finally {
      setLocating(false);
    }
  }

  const results = useMemo(() => {
    const data = search.data ?? [];
    if (!coords) return data.map((place) => ({ place, distanceMeters: undefined }));
    return data
      .map((place) => ({
        place,
        distanceMeters: haversineMeters(coords, { lat: place.lat, lng: place.lng }),
      }))
      .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  }, [search.data, coords]);

  const hasActiveSearch = Boolean(q) || coords !== null;
  const cityLabel = city.data?.city
    ? `${city.data.city}${city.data.region ? `, ${city.data.region}` : ""}`
    : "you";

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + space.sm }}>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <Text style={[ty.title, { color: t.ink }]}>Explore</Text>

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
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Chip
            active={coords !== null}
            label={
              locating
                ? "Locating you…"
                : coords
                  ? `${radiusMi} mi around ${cityLabel}`
                  : "Near me"
            }
            icon="navigation"
            onPress={locate}
          />
          {coords &&
            RADII_MI.map((r) => (
              <Chip
                key={r}
                active={r === radiusMi}
                label={`${r} mi`}
                onPress={() => setRadiusMi(r)}
              />
            ))}
        </View>
        {locError ? <Text style={[ty.small, { color: t.danger }]}>{locError}</Text> : null}
      </View>

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
          body="Coverage grows city by city. Try a wider radius or a different search."
          actionTitle={coords && radiusMi < 25 ? "Widen to 25 mi" : undefined}
          onAction={coords && radiusMi < 25 ? () => setRadiusMi(25) : undefined}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.place.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <PlaceCard place={item.place} distanceMeters={item.distanceMeters} />
          )}
        />
      )}
    </View>
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
      {icon ? <Feather name={icon} size={12} color={active ? "#fff" : t.ink} /> : null}
      <Text
        style={{
          color: active ? "#fff" : t.ink,
          fontFamily: "Inter_600SemiBold",
          fontSize: 11.5,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
