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
import { TrustProfileSheet } from "@/components/TrustProfileSheet";
import { TierTag } from "@/components/TierTag";
import { ErrorState, Loading } from "@/components/States";
import type { HalalProfileEmbed, PlaceDetail as PlaceDetailType } from "@/lib/api/types";
import { capture } from "@/lib/analytics";

const TEST_FORCE_PORK = false;

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
  const [trustOpen, setTrustOpen] = useState(false);
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

  // Funnel: a place detail was viewed (once per place load).
  useEffect(() => {
    if (place) capture("place_viewed", { place_id: place.id, place_name: place.name, city: place.city ?? null, tier: place.halal_profile?.validation_tier ?? null });
  }, [place?.id]);

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
                onPress={() => {
                  if (photoCount > 0) {
                    capture("photo_viewed", { place_id: place.id, place_name: place.name, source: "hero" });
                    setViewerIndex(0);
                  }
                }}
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
              {/* Name / cuisine / address read as one tight group. */}
              <View style={{ gap: 3 }}>
                <TierTag signal={primaryHalalSignal(place.halal_profile)} />
                <Text style={[ty.title, { color: t.ink, fontSize: 28, lineHeight: 34, marginTop: 5 }]}>
                  {place.name}
                </Text>
                {place.cuisine_types.length > 0 ? (
                  <Text style={[ty.body, { color: t.sub }]}>
                    {place.cuisine_types.slice(0, 3).map(titleCaseCuisine).join(" · ")}
                  </Text>
                ) : null}
                {place.address ? (
                  <Text style={[ty.small, { color: t.sub }]}>{place.address}</Text>
                ) : null}
                {place.google_rating != null || place.open_now != null ? (
                  <Text style={[ty.small, { marginTop: 3 }]} numberOfLines={1}>
                    {place.google_rating != null ? (
                      <Text style={{ color: t.ink, fontFamily: "Inter_700Bold" }}>
                        <Text style={{ color: "#F59E0B" }}>★ </Text>
                        {place.google_rating.toFixed(1)}
                        {place.google_rating_count != null ? (
                          <Text style={{ color: t.sub, fontFamily: "Inter_500Medium" }}>
                            {`  ·  ${place.google_rating_count} reviews`}
                          </Text>
                        ) : null}
                      </Text>
                    ) : null}
                    {place.open_now != null ? (
                      <Text
                        style={{
                          color: place.open_now ? t.accentDeep : t.sub,
                          fontFamily: "Inter_600SemiBold",
                        }}
                      >
                        {place.google_rating != null ? "  ·  " : ""}
                        {place.open_now ? "Open now" : "Closed"}
                      </Text>
                    ) : null}
                  </Text>
                ) : null}
              </View>

              <View style={{ flexDirection: "row", gap: space.sm, marginTop: 2 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={`Directions${distLabel}`}
                    variant="accent"
                    icon="navigation"
                    onPress={() => {
                      capture("directions_tapped", { place_id: place.id, place_name: place.name, has_distance: distanceMi != null });
                      Linking.openURL(
                        `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`,
                      );
                    }}
                  />
                </View>
                {place.phone ? (
                  <Button
                    title="Call"
                    variant="secondary"
                    icon="phone"
                    onPress={() => {
                      capture("call_tapped", { place_id: place.id, place_name: place.name });
                      Linking.openURL(`tel:${place.phone}`);
                    }}
                  />
                ) : null}
              </View>

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
                <TrustCard
                  profile={place.halal_profile}
                  onDetails={() => {
                    capture("trust_profile_opened", { place_id: place.id, place_name: place.name });
                    setTrustOpen(true);
                  }}
                />
              </View>

              <HoursAndContact place={place} />

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

      {place && trustOpen ? (
        <TrustProfileSheet place={place} onClose={() => setTrustOpen(false)} />
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

/** Google-sourced hours + website, styled as calm grouped rows. Hours sit
 *  collapsed as one line and expand to the full week; a quiet "from Google"
 *  line sets freshness. Renders nothing when there's neither hours nor a site. */
function HoursAndContact({ place }: { place: PlaceDetailType }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  const week = place.opening_hours_weekday_text ?? null;
  const hasHours = !!week && week.length > 0;
  const hasWebsite = !!place.website_url;
  if (!hasHours && !hasWebsite) return null;

  // Google's weekdayDescriptions are Monday-first; JS getDay() is Sunday=0.
  const todayIdx = (new Date().getDay() + 6) % 7;
  const splitLine = (line: string): [string, string] => {
    const m = line.match(/^(.*?):\s(.+)$/);
    return m ? [m[1], m[2]] : [line, ""];
  };
  const todayTime = hasHours && week[todayIdx] ? splitLine(week[todayIdx])[1] : null;

  const status = place.open_now == null ? null : place.open_now ? "Open now" : "Closed";
  const host = hasWebsite
    ? place.website_url!.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "")
    : null;
  const syncedLabel = place.google_synced_at
    ? new Date(place.google_synced_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <View
      style={{
        backgroundColor: t.card,
        borderRadius: radii.xl,
        paddingHorizontal: space.lg,
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      {hasHours ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={status ? `${status}. Show weekly hours` : "Show weekly hours"}
            onPress={() => setOpen((o) => !o)}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
              <Feather name="clock" size={18} color={t.accentDeep} />
              <View style={{ flex: 1 }}>
                <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>
                  {status ? (
                    <Text style={{ color: place.open_now ? t.accentDeep : t.sub }}>{status}</Text>
                  ) : (
                    "Hours"
                  )}
                </Text>
                {todayTime ? (
                  <Text style={[ty.small, { color: t.sub, marginTop: 1 }]}>{`Today · ${todayTime}`}</Text>
                ) : null}
              </View>
            </View>
            <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={t.sub} />
          </Pressable>
          {open ? (
            <View style={{ paddingLeft: 30, paddingBottom: 12, gap: 8 }}>
              {week!.map((line, i) => {
                const [day, time] = splitLine(line);
                const isToday = i === todayIdx;
                const color = isToday ? t.accentDeep : t.sub;
                const font = isToday ? "Inter_700Bold" : "Inter_500Medium";
                return (
                  <View key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={[ty.small, { color, fontFamily: font }]}>{isToday ? "Today" : day}</Text>
                    <Text style={[ty.small, { color, fontFamily: font }]}>{time}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}

      {hasHours && hasWebsite ? <View style={{ height: 1, backgroundColor: t.line }} /> : null}

      {hasWebsite ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open website ${host}`}
          onPress={() => {
            const url = place.website_url!.startsWith("http")
              ? place.website_url!
              : `https://${place.website_url}`;
            Linking.openURL(url);
          }}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
            <Feather name="globe" size={18} color={t.sub} />
            <Text numberOfLines={1} style={[ty.label, { color: t.ink, fontSize: 13, flex: 1 }]}>
              {host}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={t.sub} />
        </Pressable>
      ) : null}

      {syncedLabel && (hasHours || place.google_rating != null) ? (
        <Text style={[ty.small, { color: t.sub, textAlign: "center", paddingBottom: 12, fontSize: 10.5 }]}>
          {`Ratings & hours from Google · updated ${syncedLabel}`}
        </Text>
      ) : null}
    </View>
  );
}

function TrustCard({ profile, onDetails }: { profile: HalalProfileEmbed | null; onDetails?: () => void }) {
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

  const allZabihah = zabihah.length > 0 && zabihah.every(([, m]) => m === "ZABIHAH");
  const zabihahLabel = allZabihah ? "Zabihah · all meats" : "Zabihah";
  const certYear = profile.certificate_expires_at
    ? new Date(profile.certificate_expires_at).getFullYear()
    : null;
  const certLabel = `Cert · ${profile.certifying_body_name ?? "on file"}${certYear ? ` · ${certYear}` : ""}`;

  return (
    <View style={{ backgroundColor: t.card, borderRadius: radii.xl, padding: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Feather name="shield" size={17} color={t.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[ty.label, { color: t.ink, fontSize: 16 }]}>Trust profile</Text>
          <Text style={[ty.small, { color: t.sub, marginTop: 1 }]}>{basis}</Text>
        </View>
        {onDetails ? (
          <Pressable onPress={onDetails} accessibilityLabel="Full trust profile" style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
            <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_600SemiBold", fontSize: 13 }]}>Details</Text>
            <Feather name="chevron-right" size={15} color={t.accentDeep} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
        {profile.menu_posture === "FULLY_HALAL" ? <Wash label="Fully halal menu" /> : null}
        {zabihah.some(([, m]) => m === "ZABIHAH") ? <Wash label={zabihahLabel} /> : null}
        {profile.alcohol_policy === "NONE" ? <Wash label="No alcohol" /> : null}
        {/* Pork is only surfaced when it's actually served — a red alert, not a
            "pork-free" reassurance on every (majority) place. */}
        {(TEST_FORCE_PORK || profile.has_pork) ? <Wash label="Serves pork" danger /> : null}
        {profile.has_certification ? <Wash label={certLabel} neutral /> : null}
      </View>
    </View>
  );
}

function Wash({ label, neutral, danger }: { label: string; neutral?: boolean; danger?: boolean }) {
  const t = useTheme();
  const bg = danger ? t.dangerSoft : neutral ? t.zincSoft : t.accentSoft;
  const fg = danger ? t.danger : neutral ? t.zinc : t.accentDeep;
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 5,
      }}
    >
      <Text
        style={{
          color: fg,
          fontFamily: "Inter_700Bold",
          fontSize: 11.5,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
