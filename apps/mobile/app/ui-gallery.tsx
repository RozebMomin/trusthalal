import { Redirect, router } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Cell, Tag } from "@/ui/kit";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * UI review index — one row per mockup screen. Built rows navigate to
 * the real route (rendering FIXTURES until wiring); pending rows show
 * a dashed tag. Reachable from Profile → "UI gallery" (dev builds).
 * Tracker: docs/ui-build-plan.md
 */
const SCREENS: Array<{ n: number; name: string; route?: string; note?: string }> = [
  { n: 2, name: "Map view", note: "P1 — needs react-native-maps" },
  { n: 7, name: "Activity", route: "/ui/activity" },
  { n: 14, name: "Location picker", route: "/ui/location-picker" },
  { n: 15, name: "Report an issue", route: "/ui/report-issue" },
  { n: 16, name: "Verify home", route: "/ui/verify-home" },
  { n: 17, name: "Verifier profile", route: "/ui/verifier-profile" },
  { n: 19, name: "Visit flow (19–22)", route: "/ui/visit-flow" },
  { n: 23, name: "Trust profile expanded", route: "/ui/trust-profile" },
  { n: 25, name: "Dispute timeline", route: "/ui/dispute-timeline" },
  { n: 26, name: "Search — typing", route: "/ui/search-typing" },
  { n: 27, name: "Become a verifier (wired)", route: "/become-a-verifier" },
  { n: 29, name: "Notifications", route: "/ui/notifications" },
  { n: 30, name: "Photo viewer", route: "/ui/photo-viewer" },
  { n: 1, name: "Explore", route: "/(tabs)" },
  { n: 3, name: "Place detail", route: "/places/fx-karachi" },
  { n: 4, name: "Filters sheet", note: "open from Explore" },
  { n: 5, name: "Saved", route: "/(tabs)/saved" },
  { n: 8, name: "Profile", route: "/(tabs)/profile" },
  { n: 9, name: "Onboarding — promise", route: "/onboarding" },
  { n: 12, name: "Sign in", route: "/(auth)/sign-in" },
  { n: 13, name: "Create account", route: "/(auth)/sign-up" },
  { n: 18, name: "Empty state", note: "search 'zzz' in Explore" },
  { n: 24, name: "Disputed place", route: "/places/fx-bosphorus" },
];

export default function UiGallery() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Dev-only screen — unreachable in production, even via deep link.
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.lg, padding: space.lg, gap: space.md, paddingBottom: 60 }}
    >
      <Text style={[ty.title, { color: t.ink }]}>UI gallery</Text>
      <Text style={[ty.small, { color: t.sub }]}>
        Screens vs docs/2026-07-06-mobile-app-mockups.html — fixtures only, wiring comes later.
      </Text>
      <Card>
        {SCREENS.map((s, i) => (
          <Cell
            key={s.n}
            last={i === SCREENS.length - 1}
            onPress={s.route ? () => router.push(s.route as never) : undefined}
            left={
              <Text style={[ty.body, { color: s.route ? t.ink : t.sub }]}>
                {s.n} · {s.name}
              </Text>
            }
            right={s.route ? <Tag label="BUILT" tone="wash" /> : <Tag label={(s.note ?? "todo").toUpperCase()} tone="dashed" />}
          />
        ))}
      </Card>
    </ScrollView>
  );
}
