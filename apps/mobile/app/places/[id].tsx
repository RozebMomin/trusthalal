import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useMyFavorites, usePlaceDetail, useToggleFavorite } from "@/lib/api/hooks";
import { primaryHalalSignal } from "@/lib/halal-display";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
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
              <Image
                source={{ uri: place.hero_photo_url }}
                accessibilityLabel={place.name}
                style={{ height: 220, width: "100%" }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ height: insets.top + 44 }} />
            )}

            <View style={{ padding: space.lg, gap: space.md }}>
              <TierTag signal={primaryHalalSignal(place.halal_profile)} />
              <Text style={[ty.title, { color: t.ink }]}>{place.name}</Text>
              {place.address ? (
                <Text style={[ty.small, { color: t.sub }]}>
                  {[place.address, place.city, place.region].filter(Boolean).join(" · ")}
                </Text>
              ) : null}

              <View style={{ flexDirection: "row", gap: space.sm }}>
                <View style={{ flex: 2 }}>
                  <Button
                    title="Directions"
                    variant="accent"
                    onPress={() =>
                      Linking.openURL(
                        `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`,
                      )
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={saved ? "Saved ✓" : "Save"}
                    variant="secondary"
                    onPress={() =>
                      me
                        ? toggle.mutate({ placeId: place.id, saved })
                        : router.push("/(auth)/sign-in")
                    }
                  />
                </View>
              </View>

              <TrustCard profile={place.halal_profile} />

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
          backgroundColor: t.card,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      >
        <Feather name="chevron-left" size={20} color={t.ink} />
      </Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 8,
      }}
    >
      <Text style={[ty.small, { color: t.sub }]}>{label}</Text>
      <Text style={[ty.small, { color: t.ink, fontFamily: "Inter_600SemiBold" }]}>{value}</Text>
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

  return (
    <View style={{ backgroundColor: t.card, borderRadius: radii.xl, padding: space.lg }}>
      <Text style={[ty.seg, { color: t.sub, marginBottom: 4 }]}>Halal profile</Text>
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
