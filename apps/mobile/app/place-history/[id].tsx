import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HalalHistoryTimeline } from "@/components/TrustProfileSheet";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { ScreenHeader } from "@/ui/kit";

/**
 * Dedicated Trust History screen.
 *
 * A deliberate, history-only view — not the trust profile with a timeline
 * bolted on the end. Reached from the "Trust history" row on a place. The
 * place name rides along as a param so the header can name what you're looking
 * at without a second fetch; the timeline fetches its own data from the id.
 */
export default function PlaceHistoryScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          padding: space.lg,
          paddingBottom: insets.bottom + 60,
          gap: space.lg,
        }}
      >
        <ScreenHeader title="Trust history" backLabel="Back" onBack={() => router.back()} />

        <Text style={[ty.body, { color: t.sub, fontSize: 14, marginTop: -6 }]}>
          {name ? `Verifications, disputes and changes for ${name}.` : "Verifications, disputes and changes over time."}
        </Text>

        <HalalHistoryTimeline placeId={id} />
      </ScrollView>
    </View>
  );
}
