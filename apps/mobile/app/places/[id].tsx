import { Feather, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useMyFavorites, usePlaceDetail, useToggleFavorite } from "@/lib/api/hooks";
import { primaryHalalSignal } from "@/lib/halal-display";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { HeartButton } from "@/components/HeartButton";
import { PhotoViewer } from "@/components/PhotoViewer";
import { TierTag } from "@/components/TierTag";
import { ErrorState, Loading } from "@/components/States";
import type { HalalProfileEmbed } from "@/lib/api/types";

const POSTURE_LABELS: Record<string, string> = {
  FULLY_HALAL: "Fully halal",
  MIXED_SEPARATE_KITCHENS: "Separate kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options",
  HALAL_UPON_REQUEST: "On request",
  MIXED_SHARED_KITCHEN: "Shared kitchen",
};

function titleCaseCuisine(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
}

/** Straight-line miles between two coords — for the "Directions · X mi" label. */
function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function PlaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const detail = usePlaceDetail(id);
  const { data: me } = useCurrentUser();
  const favorites = useMyFavorites(Boolean(me));
  const toggle = useToggleFavorite();

  const place = detail.data;
  const saved = Boolean(favorites.data?.some((f) => f.place.id === id));
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const photoCount = place?.photos.length ?? 0;

  // Distance for the Directions button — best-effort from the last known
  // location (no prompt); label just hides if we can't resolve it.
  const [distanceMi, setDistanceMi] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!place) return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const pos = await Location.getLastKnownPositionAsync();
        if (pos && !cancelled) {
          setDistanceMi(
            haversineMi(
              { lat: pos.coords.latitude, lng: pos.coords.longitude },
              { lat: place.lat, lng: place.lng },
            ),
          );
        }
      } catch {
        /* no location — just show "Directions" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place?.id, place?.lat, place?.lng]);
  const distLabel =
    distanceMi != null ? ` · ${distanceMi < 10 ? distanceMi.toFixed(1) : Math.round(distanceMi)} mi` : "";

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {detail.isLoading ? (
          <Loading />
        ) : detail.error || !place ? (
          <ErrorState
            message="This restaurant may have been removed, or the link might be out of date."
            onRetry={() => detail.refetch()}
          />
        ) : (
          <>
            {place.hero_photo_url ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={photoCount > 0 ? `View ${photoCount} photos` : place.name}
                onPress={() => photoCount > 0 && setViewerIndex(0)}
              >
                <Image
                  source={{ uri: place.hero_photo_url }}
                  accessibilityLabel={place.name}
                  style={{ height: 220, width: "100%" }}
                  resizeMode="cover"
                />
                {photoCount > 0 ? (
                  <View
                    style={{
                      position: "absolute", right: space.lg, bottom: 40,
                      flexDirection: "row", alignItems: "center", gap: 5,
                      backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999,
                      paddingHorizontal: 12, paddingVertical: 6,
                    }}
                  >
                    <Feather name="image" size={13} color="#fff" />
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                      {photoCount} photo{photoCount === 1 ? "" : "s"}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ) : (
              <View style={{ height: insets.top + 44 }} />
            )}

            <View
              style={{
                marginTop: place.hero_photo_url ? -28 : 0,
                backgroundColor: t.bg,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: space.lg,
                gap: space.md,
              }}
            >
              <TierTag signal={primaryHalalSignal(place.halal_profile)} />
              <Text style={[ty.title, { color: t.ink, fontSize: 28, lineHeight: 32 }]}>
                {place.name}
              </Text>
              {place.cuisine_types.length > 0 ? (
                <Text style={[ty.body, { color: t.sub }]}>
                  {place.cuisine_types.slice(0, 3).map(titleCaseCuisine).join(" · ")}
                </Text>
              ) : null}
              {place.address ? (
                <Text style={[ty.small, { color: t.sub }]}>
                  {[place.address, place.city, place.region].filter(Boolean).join(" · ")}
                </Text>
              ) : null}

              <Button
                title={`Directions${distLabel}`}
                variant="accent"
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`,
                  )
                }
              />

              {place.halal_profile?.dispute_state === "DISPUTED" ||
              place.halal_profile?.dispute_state === "RECONCILING" ? (
                <View style={{ backgroundColor: t.amberSoft, borderRadius: radii.xl, padding: space.lg, flexDirection: "row", gap: 10 }}>
                  <Feather name="alert-triangle" size={18} color={t.amber} />
                  <View style={{ flex: 1 }}>
                    <Text style={[ty.label, { color: t.amber, fontSize: 12.5 }]}>This profile is being reviewed</Text>
                    <Text style={[ty.small, { color: t.amber, marginTop: 3 }]}>
                      A diner reported part of this profile may be out of date. The owner is responding. Last verified info shown below.
                    </Text>
                  </View>
                </View>
              ) : null}
              <View style={{ opacity: place.halal_profile?.dispute_state === "DISPUTED" ? 0.75 : 1 }}>
                <TrustCard profile={place.halal_profile} />
              </View>

              <Text style={[ty.small, { color: t.sub, textAlign: "center", marginTop: space.sm }]}>
                Spot something wrong? Reporting arrives in the next build — for now, report on
                halalfoodnearme.com.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Floating back button (glass) */}
      <Pressable
        accessibilityLabel="Back"
        onPress={() => router.back()}
        style={{
          position: "absolute",
          top: insets.top + 6,
          left: space.lg,
          width: 36,
          height: 36,
          borderRadius: 999,
          // Fixed white glass: this floats over the hero PHOTO, which
          // doesn't theme — matching the save/share buttons.
          backgroundColor: "rgba(255,255,255,0.92)",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      >
        <Feather name="chevron-left" size={20} color="#0B0B0E" />
      </Pressable>

      {/* Glass save + share over the hero (mockup 3) */}
      <View style={{ position: "absolute", top: insets.top + 6, right: space.lg, flexDirection: "row", gap: 8 }}>
        <HeartButton
          glass
          saved={saved}
          onPress={() => {
            if (id.startsWith("fx-")) {
              Alert.alert("UI preview", "This is a fixture screen — saving works on live places.");
              return;
            }
            if (!me) {
              router.push("/(auth)/sign-in");
              return;
            }
            toggle.mutate(
              { placeId: id, saved, place: place ?? undefined },
              {
                onError: (e) =>
                  Alert.alert(
                    "Couldn't save",
                    e instanceof Error ? e.message : "Try again in a moment.",
                  ),
              },
            );
          }}
        />
        <Glass
          ion="share-outline"
          label="Share"
          onPress={() =>
            Share.share({ url: `https://halalfoodnearme.com/places/${id}` }).catch(() => undefined)
          }
        />
      </View>

      {place && viewerIndex !== null ? (
        <PhotoViewer
          photos={place.photos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}

function Glass({
  icon,
  ion,
  label,
  onPress,
  active,
}: {
  icon?: keyof typeof Feather.glyphMap;
  /** Ionicons name — used for states Feather can't draw (filled heart). */
  ion?: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        // Fixed white glass over the hero photo — photos don't theme,
        // so neither does this. t.card here made a dark circle in dark
        // mode with a dark icon on it.
        width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.92)",
        alignItems: "center", justifyContent: "center",
        shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 }, elevation: 4,
      }}
    >
      {ion ? (
        <Ionicons name={ion} size={18} color={active ? t.danger : "#0B0B0E"} />
      ) : (
        <Feather name={icon!} size={17} color={active ? t.danger : "#0B0B0E"} />
      )}
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 9,
      }}
    >
      <Text style={[ty.body, { color: t.sub }]}>{label}</Text>
      <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold" }]}>{value}</Text>
    </View>
  );
}

function TrustCard({ profile }: { profile: HalalProfileEmbed | null }) {
  const t = useTheme();
  if (!profile) {
    return (
      <View style={{ backgroundColor: t.card, borderRadius: radii.xl, padding: space.lg }}>
        <Text style={[ty.label, { color: t.ink }]}>No halal profile yet</Text>
        <Text style={[ty.small, { color: t.sub, marginTop: 4 }]}>
          This restaurant hasn't been verified by Trust Halal. Owners can submit a halal claim
          through the owner portal.
        </Text>
      </View>
    );
  }
  const zabihah = (
    [
      ["Chicken", profile.chicken_slaughter],
      ["Beef", profile.beef_slaughter],
      ["Lamb", profile.lamb_slaughter],
      ["Goat", profile.goat_slaughter],
    ] as const
  ).filter(([, m]) => m && m !== "NOT_SERVED");

  const basis =
    profile.validation_tier === "TRUST_HALAL_VERIFIED"
      ? "Confirmed in person"
      : profile.has_certification
        ? `Certified · ${profile.certifying_body_name ?? "on file"}`
        : "Owner-attested";

  return (
    <View style={{ backgroundColor: t.card, borderRadius: radii.xl, padding: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Feather name="shield" size={16} color={t.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[ty.label, { color: t.ink, fontSize: 15 }]}>Trust profile</Text>
          <Text style={[ty.small, { color: t.sub, marginTop: 1 }]}>{basis}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {profile.menu_posture === "FULLY_HALAL" ? <Wash label="Fully halal menu" /> : null}
        {zabihah.some(([, m]) => m === "ZABIHAH") ? <Wash label="Zabihah" /> : null}
        {profile.alcohol_policy === "NONE" ? <Wash label="No alcohol" /> : null}
        {!profile.has_pork ? <Wash label="Pork-free" /> : null}
        {profile.has_certification ? (
          <Wash label={`Cert · ${profile.certifying_body_name ?? "on file"}`} neutral />
        ) : null}
      </View>
      <Row label="Menu" value={POSTURE_LABELS[profile.menu_posture] ?? profile.menu_posture} />
      {zabihah.map(([meat, method]) => (
        <Row key={meat} label={meat} value={method === "ZABIHAH" ? "Zabihah ✓" : "Machine"} />
      ))}
      <Row
        label="Alcohol"
        value={
          profile.alcohol_policy === "NONE"
            ? "None served"
            : profile.alcohol_policy === "BEER_AND_WINE_ONLY"
              ? "Beer & wine"
              : profile.alcohol_policy === "FULL_BAR"
                ? "Full bar"
                : "Unknown"
        }
      />
      <Row label="Pork" value={profile.has_pork ? "On the menu" : "Pork-free"} />
      {profile.has_certification ? (
        <Row label="Certificate" value={profile.certifying_body_name ?? "On file"} />
      ) : null}
    </View>
  );
}

function Wash({ label, neutral }: { label: string; neutral?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: neutral ? t.zincSoft : t.accentSoft,
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 5,
      }}
    >
      <Text
        style={{
          color: neutral ? t.zinc : t.accentDeep,
          fontFamily: "Inter_700Bold",
          fontSize: 11.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
