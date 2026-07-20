import { Feather, Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { useEffect, useState, type ReactNode } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useMyFavorites, usePlaceDetail, useToggleFavorite } from "@/lib/api/hooks";
import { PlaceReviews } from "@/components/PlaceReviews";
import { RatingLine } from "@/components/RatingLine";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { HeartButton } from "@/components/HeartButton";
import { PhotoViewer } from "@/components/PhotoViewer";
import { TrustProfileSheet } from "@/components/TrustProfileSheet";
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
              {/* No tier tag here. The trust banner below states the tier in
                  full sentences a few hundred pixels down; a pill repeating
                  "CERTIFIED · HMS" above the name made the certifier's name
                  appear three times in one screen. The tag still earns its
                  place on search cards, where there's no banner. */}
              <View style={{ gap: 3 }}>
                <Text style={[ty.title, { color: t.ink, fontSize: 28, lineHeight: 34 }]}>
                  {place.name}
                </Text>
                {place.google_rating != null ||
                (place.review_count ?? 0) > 0 ||
                place.cuisine_types.length > 0 ? (
                  <Text style={[ty.body, { color: t.sub }]} numberOfLines={1}>
                    {/* Both ratings, each attributed. A bare star here read
                        as Trust Halal's own score when it was Google's. */}
                    <RatingLine place={place} starColor="#F59E0B" labelColor={t.sub} />
                    {(place.google_rating != null || (place.review_count ?? 0) > 0) &&
                    place.cuisine_types.length > 0
                      ? " · "
                      : ""}
                    {place.cuisine_types.slice(0, 3).map(titleCaseCuisine).join(" · ")}
                  </Text>
                ) : null}
                {place.address ? (
                  <Text style={[ty.small, { color: t.sub }]}>{place.address}</Text>
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

              <HoursCard place={place} />

              {/* Opinion after the verified facts, matching the web ordering. */}
              <PlaceReviews
                place={place}
                signedIn={Boolean(me)}
                emailVerified={me?.email_verified === true}
              />

              {/* This used to read "Reporting arrives in the next build".
                  That was written before review reporting shipped and stayed
                  after it did, so the app was telling diners a feature it has
                  doesn't exist — and telling an App Review reviewer that the
                  1.2 reporting requirement is unimplemented, on the very
                  screen where the flag icon sits. Reporting a REVIEW is in
                  the app (the flag on each review); challenging a
                  RESTAURANT'S halal profile is still web-only, so that half
                  keeps the link. */}
              <Text
                style={[
                  ty.small,
                  { color: t.sub, textAlign: "center", marginTop: space.sm, lineHeight: 17 },
                ]}
              >
                Something wrong with a review? Tap the flag on it. To challenge this
                restaurant&apos;s halal profile, open it on{" "}
                <Text
                  style={{ color: t.accentDeep, fontFamily: "Inter_600SemiBold" }}
                  onPress={() =>
                    Linking.openURL(`https://halalfoodnearme.com/places/${place.id}`)
                  }
                >
                  halalfoodnearme.com
                </Text>
                .
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

/** Google-sourced opening hours as a calm card: a status line (Open/Closed +
 *  today's times) over the full week, collapsed by default. A quiet "from
 *  Google" line sets freshness. Renders nothing when a place has no hours.
 *
 *  Collapsed is the right default because the status line already answers the
 *  question almost everyone has — can I go now? Expanding to seven rows to
 *  say that pushed the reviews section a screen further down for the minority
 *  who wanted Thursday. The chevron is right there for them. */
// Weekday index Monday=0 .. Sunday=6 (matches Google's Monday-first
// weekday_text) for "now" in the given IANA timezone. Falls back to the
// device's local day when tz is missing or unrecognized.
function weekdayIndexInTz(tz: string | null): number {
  const now = new Date();
  if (tz) {
    try {
      const wd = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
      }).format(now);
      const map: Record<string, number> = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6,
      };
      if (wd in map) return map[wd];
    } catch {
      // Unknown tz — fall through to device-local.
    }
  }
  return (now.getDay() + 6) % 7;
}

function HoursCard({ place }: { place: PlaceDetailType }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  const week = place.opening_hours_weekday_text ?? null;
  const hasHours = !!week && week.length > 0;
  if (!hasHours) return null;

  // Google's weekdayDescriptions are Monday-first. Compute "today" in
  // the PLACE's timezone (not the device's) so a diner browsing a place
  // in another timezone — or near midnight — sees the right day. The
  // open/closed status is already server-computed against the place tz.
  const todayIdx = weekdayIndexInTz(place.timezone ?? null);
  const splitLine = (line: string): [string, string] => {
    const m = line.match(/^(.*?):\s(.+)$/);
    return m ? [m[1], m[2]] : [line, ""];
  };
  const todayTime = week[todayIdx] ? splitLine(week[todayIdx])[1] : null;

  const status = place.open_now == null ? null : place.open_now ? "Open now" : "Closed";
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status ? `${status}. Toggle weekly hours` : "Toggle weekly hours"}
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

      {syncedLabel ? (
        <Text style={[ty.small, { color: t.sub, textAlign: "center", paddingBottom: 12, fontSize: 10.5 }]}>
          {`Ratings & hours from Google · updated ${syncedLabel}`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The halal verdict, in the same four-part shape as the web detail page
 * (``apps/consumer/src/components/place-trust-summary.tsx``). Keep the two
 * in step — a diner who checks a place on the phone and again on the laptop
 * should not get two different-looking answers to the same question.
 *
 *   1. Banner   — what the kitchen is, in the largest type in the card,
 *                 over a colour that encodes how well we know it.
 *   2. Facts    — pork, alcohol, cooking wine.
 *   3. Meats    — only what's actually served.
 *   4. Provenance — who checked, when, and the way into the evidence.
 *
 * ## What this replaced, and why
 *
 * A header row reading "Trust profile / Certified · HMS" above a chip rail
 * containing "Fully halal menu", "Zabihah · all meats", "No alcohol" and
 * "Cert · HMS". Stacked under the page's tier tag, which also said
 * "CERTIFIED · HMS", the certifier's name appeared three times inside one
 * screen while the question a diner actually opened the page with — is this
 * kitchen fully halal? — was a chip the same size and weight as everything
 * else.
 *
 * ## The rule not to "simplify" later
 *
 * The headline says what the RESTAURANT claims; the colour and proof line
 * say how much PROOF we hold. They are deliberately separate. A self-attested
 * fully-halal kitchen and a verifier-inspected one make the identical claim
 * and are not the same fact. SELF_ATTESTED is therefore never green — a green
 * banner there would launder the owner's word into Trust Halal's endorsement,
 * which is the one thing this product exists not to do.
 */

const TIER_PROOF: Record<string, string> = {
  TRUST_HALAL_VERIFIED: "A Trust Halal verifier checked this in person",
  CERTIFICATE_ON_FILE: "Halal certificate on file with us",
  SELF_ATTESTED: "The owner's own description — nobody has verified it",
};

const MENU_POSTURE_HEADLINE: Record<string, string> = {
  FULLY_HALAL: "Fully halal kitchen",
  MIXED_SEPARATE_KITCHENS: "Halal in a separate kitchen",
  HALAL_OPTIONS_ADVERTISED: "Halal options on the menu",
  HALAL_UPON_REQUEST: "Halal options on request",
  MIXED_SHARED_KITCHEN: "Halal options · shared kitchen",
};

const ALCOHOL_POLICY_LINE: Record<string, string> = {
  NONE: "No alcohol served",
  BEER_AND_WINE_ONLY: "Beer and wine served",
  FULL_BAR: "Full bar — beer, wine, spirits",
};

const SLAUGHTER_LABELS: Record<string, string> = {
  ZABIHAH: "Zabihah",
  MACHINE: "Machine",
  NOT_SERVED: "Not served",
};

/** Banner fill by PROOF level — read the note above before changing. */
function tierBanner(tier: string, t: ReturnType<typeof useTheme>) {
  switch (tier) {
    case "TRUST_HALAL_VERIFIED":
      return { bg: t.accent, fg: t.onAccent };
    case "CERTIFICATE_ON_FILE":
      return { bg: t.accentDeep, fg: t.onAccent };
    default:
      // Deliberately not green. Nobody independent has checked this.
      return { bg: t.zinc, fg: t.card };
  }
}

function TrustCard({ profile, onDetails }: { profile: HalalProfileEmbed | null; onDetails?: () => void }) {
  const t = useTheme();
  if (!profile) {
    return (
      <View
        style={{
          borderRadius: radii.xl,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: t.line,
          padding: space.lg,
          alignItems: "center",
        }}
      >
        <Feather name="info" size={20} color={t.sub} />
        <Text style={[ty.label, { color: t.ink, marginTop: 8 }]}>No halal information yet</Text>
        <Text style={[ty.small, { color: t.sub, marginTop: 4, textAlign: "center", lineHeight: 18 }]}>
          Nobody has told us how this kitchen works, so we can&apos;t say anything about it either
          way. If you own this restaurant, you can add your halal details.
        </Text>
      </View>
    );
  }

  const banner = tierBanner(profile.validation_tier, t);
  const headline = MENU_POSTURE_HEADLINE[profile.menu_posture] ?? "Halal information on file";
  const proof = TIER_PROOF[profile.validation_tier] ?? "";

  return (
    <View style={{ borderRadius: radii.xl, overflow: "hidden", backgroundColor: t.card }}>
      {/* The claim, in the largest type in the card. Colour is the proof
          level, not the claim — see the note above. */}
      <View style={{ backgroundColor: banner.bg, paddingHorizontal: space.lg, paddingVertical: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9 }}>
          <Feather name="shield" size={18} color={banner.fg} style={{ marginTop: 1 }} />
          <Text style={[ty.title, { color: banner.fg, fontSize: 18, lineHeight: 23, flex: 1 }]}>
            {headline}
          </Text>
        </View>
        {proof ? (
          <Text style={[ty.small, { color: banner.fg, opacity: 0.9, marginTop: 3, paddingLeft: 27 }]}>
            {proof}
          </Text>
        ) : null}
      </View>

      <View style={{ padding: space.lg, gap: space.md }}>
        <KitchenAndPantry profile={profile} />

        {profile.seafood_only ? (
          <Text style={[ty.small, { color: t.sub }]}>
            Seafood-only kitchen — no land meat or poultry served.
          </Text>
        ) : (
          <ServedMeats profile={profile} />
        )}

        {profile.caveats ? (
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              backgroundColor: t.amberSoft,
              borderRadius: radii.md,
              padding: 11,
            }}
          >
            <Feather name="alert-circle" size={15} color={t.amber} style={{ marginTop: 1 }} />
            <Text style={[ty.small, { color: t.amber, flex: 1, lineHeight: 17 }]}>
              {profile.caveats}
            </Text>
          </View>
        ) : null}

        <ProvenanceFooter profile={profile} onDetails={onDetails} />
      </View>
    </View>
  );
}

/** Pork, alcohol, cooking wine — each a single sentence a diner can scan as
 *  a yes/no. Menu posture is NOT repeated here; it's the banner headline. */
function KitchenAndPantry({ profile }: { profile: HalalProfileEmbed }) {
  const t = useTheme();
  const pork = TEST_FORCE_PORK || profile.has_pork;

  const lines: Array<{ node: ReactNode; text: string; color: string }> = [
    {
      node: (
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 999,
            backgroundColor: pork ? t.dangerSoft : t.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: pork ? t.danger : t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 11 }}>
            {pork ? "✕" : "✓"}
          </Text>
        </View>
      ),
      text: pork ? "Pork is served" : "No pork on the menu",
      color: t.ink,
    },
  ];

  if (profile.alcohol_policy) {
    const none = profile.alcohol_policy === "NONE";
    lines.push({
      node: (
        <View style={{ width: 20, alignItems: "center" }}>
          <Feather name="x-circle" size={15} color={none ? t.accentDeep : t.amber} />
        </View>
      ),
      text: ALCOHOL_POLICY_LINE[profile.alcohol_policy] ?? "Alcohol policy on file",
      color: t.ink,
    });
  }

  if (profile.alcohol_in_cooking) {
    lines.push({
      node: (
        <View style={{ width: 20, alignItems: "center" }}>
          <Feather name="alert-circle" size={15} color={t.amber} />
        </View>
      ),
      text: "Some dishes are cooked with alcohol (wine reductions, mirin, etc.).",
      color: t.amber,
    });
  }

  return (
    <View style={{ gap: 8 }}>
      {lines.map((line, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          {line.node}
          <Text style={[ty.small, { color: line.color, flex: 1, fontSize: 13, lineHeight: 18 }]}>
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Served meats get a chip each; everything absent collapses into one line.
 *
 * The old chip rail said "Zabihah · all meats" — one chip for up to four
 * facts. That reads fine when every meat matches, and hides a real
 * distinction the moment one doesn't: a place with zabihah chicken and
 * machine-slaughtered beef could not say so. Machine keeps an amber chip
 * and must never quietly read as zabihah.
 */
function ServedMeats({ profile }: { profile: HalalProfileEmbed }) {
  const t = useTheme();
  const rows = [
    { label: "Chicken", method: profile.chicken_slaughter },
    { label: "Beef", method: profile.beef_slaughter },
    { label: "Lamb", method: profile.lamb_slaughter },
    { label: "Goat", method: profile.goat_slaughter },
  ];

  const served = rows.filter((r) => r.method && r.method !== "NOT_SERVED");
  const absent = rows.filter((r) => r.method === "NOT_SERVED");

  if (served.length === 0) {
    return (
      <Text style={[ty.small, { color: t.sub }]}>
        No chicken, beef, lamb or goat is served here.
      </Text>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {served.map((row) => {
          const machine = row.method === "MACHINE";
          return (
            <View
              key={row.label}
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                gap: 5,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: machine ? t.amber : t.accentDeep,
                backgroundColor: machine ? t.amberSoft : t.accentSoft,
                paddingHorizontal: 9,
                paddingVertical: 5,
              }}
            >
              <Text style={{ color: machine ? t.amber : t.accentDeep, opacity: 0.75, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                {row.label}
              </Text>
              <Text style={{ color: machine ? t.amber : t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 12 }}>
                {SLAUGHTER_LABELS[row.method as string] ?? row.method}
              </Text>
            </View>
          );
        })}
      </View>
      {absent.length > 0 ? (
        <Text style={[ty.small, { color: t.sub, fontSize: 11 }]}>
          {absent.map((r) => r.label.toLowerCase()).join(", ")}
          {absent.length === 1 ? " isn't" : " aren't"} served here.
        </Text>
      ) : null}
    </View>
  );
}

/** Who checked, when, and the way into the evidence. Absorbs what used to be
 *  a separate "Cert · HMS" chip and the header's "Certified · HMS" subtitle —
 *  the certifier's name now appears exactly once on the screen. */
function ProvenanceFooter({
  profile,
  onDetails,
}: {
  profile: HalalProfileEmbed;
  onDetails?: () => void;
}) {
  const t = useTheme();
  const issuer = profile.certifying_body_name;
  const checked = relativeDay(profile.last_verified_at);

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: t.line,
        paddingTop: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Feather name="calendar" size={13} color={t.sub} />
      <Text style={[ty.small, { color: t.sub, flex: 1, fontSize: 11, lineHeight: 16 }]}>
        {issuer ? (
          <>
            Certified by <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold" }}>{issuer}</Text>
            {" · "}
          </>
        ) : null}
        {checked ? `Checked ${checked}` : "Checked recently"}
      </Text>
      {onDetails ? (
        <Pressable
          onPress={onDetails}
          accessibilityLabel="Full trust profile"
          hitSlop={8}
          style={{ flexDirection: "row", alignItems: "center", gap: 1 }}
        >
          <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 12 }]}>
            See the evidence
          </Text>
          <Feather name="chevron-right" size={14} color={t.accentDeep} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** "3 days ago" / "last month" — matches the web's relative freshness line. */
function relativeDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "last month" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "last year" : `${years} years ago`;
}

