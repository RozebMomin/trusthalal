import { router } from "expo-router";
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
  { n: 1, name: "Explore", route: "/(tabs)" },
  { n: 2, name: "Map view", note: "P1" },
  { n: 3, name: "Place detail", route: "/places/fx-karachi" },
  { n: 4, name: "Filters sheet", note: "open from Explore" },
  { n: 5, name: "Saved", route: "/(tabs)/saved" },
  { n: 6, name: "Verifier — disclosure step", note: "Phase 11" },
  { n: 7, name: "Activity (dark)", note: "next batch" },
  { n: 8, name: "Profile", route: "/(tabs)/profile" },
  { n: 9, name: "Onboarding — promise", route: "/onboarding" },
  { n: 12, name: "Sign in", route: "/(auth)/sign-in" },
  { n: 13, name: "Create account", route: "/(auth)/sign-up" },
  { n: 14, name: "Location picker", note: "next batch" },
  { n: 15, name: "Report an issue", note: "next batch" },
  { n: 18, name: "Empty state", note: "search 'zzz' in Explore" },
  { n: 23, name: "Trust profile expanded", note: "next batch" },
  { n: 24, name: "Disputed place", route: "/places/fx-bosphorus" },
  { n: 26, name: "Search — typing", note: "next batch" },
  { n: 30, name: "Photo viewer", note: "next batch" },
];

export default function UiGallery() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
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
