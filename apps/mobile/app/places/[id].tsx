import { Feather, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Image, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
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
              <Text style={[ty.title, { color: t.ink }]}>{place.name}</Text>
              {place.address ? (
                <Text style={[ty.small, { color: t.sub }]}>
                  {[place.address, place.city, place.region].filter(Boolean).join(" · ")}
                </Text>
              ) : null}

              <Button
                title="Directions"
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

      {/* Glass save + share over the hero (mockup 3) */}
      <View style={{ position: "absolute", top: insets.top + 6, right: space.lg, flexDirection: "row", gap: 8 }}>
        <Glass
          ion={saved ? "heart" : "heart-outline"}
          label={saved ? "Unsave" : "Save"}
          active={saved}
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
              { placeId: id, saved },
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
          icon="share"
          label="Share"
          onPress={() =>
            Share.share({ url: `https://halalfoodnearme.com/places/${id}` }).catch(() => undefined)
          }
        />
      </View>
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
        width: 36, height: 36, borderRadius: 999, backgroundColor: t.card,
        alignItems: "center", justifyContent: "center",
        shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 }, elevation: 4,
      }}
    >
      {ion ? (
        <Ionicons name={ion} size={18} color={active ? t.danger : t.ink} />
      ) : (
        <Feather name={icon!} size={17} color={active ? t.danger : t.ink} />
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
      <Text style={[ty.seg, { color: t.sub, marginBottom: 8 }]}>Trust profile</Text>
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
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 3.5,
      }}
    >
      <Text
        style={{
          color: neutral ? t.zinc : t.accentDeep,
          fontFamily: "Inter_700Bold",
          fontSize: 9.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
