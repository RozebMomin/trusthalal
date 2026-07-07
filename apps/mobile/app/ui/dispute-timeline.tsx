import { Text, View } from "react-native";
import { Card, Tag } from "@/ui/kit";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "./_shared";

const STEPS = [
  { title: "Report upheld — profile corrected", body: 'Alcohol policy updated to "beer & wine served." The public page now shows the correction.', when: "JUL 5 · TRUST HALAL", active: true },
  { title: "Owner responded", body: '"We added a beer list this spring — updating our profile."', when: "JUN 30 · OWNER" },
  { title: "Under review", body: "Sent to the owner and Trust Halal reviewers.", when: "JUN 26 · AUTOMATIC" },
  { title: "You filed this report", body: "1 photo attached.", when: "JUN 26 · YOU" },
];

export default function DisputeTimeline() {
  const t = useTheme();
  return (
    <UiScreen>
      <Tag label="RESOLVED · UPHELD" tone="wash" />
      <Text style={[ty.title, { color: t.ink }]}>Your report on{"\n"}Bosphorus Grill</Text>
      <Text style={[ty.small, { color: t.sub }]}>Alcohol is served · filed Jun 26</Text>
      <View style={{ paddingLeft: 26, marginTop: space.sm }}>
        <View style={{ position: "absolute", left: 8, top: 6, bottom: 6, width: 2, backgroundColor: t.line }} />
        {STEPS.map((s) => (
          <View key={s.title} style={{ paddingBottom: 18 }}>
            <View style={{ position: "absolute", left: -24, top: 2, width: s.active ? 18 : 14, height: s.active ? 18 : 14, borderRadius: 999, backgroundColor: s.active ? t.accent : t.line, borderWidth: 3, borderColor: t.bg }} />
            <Text style={[ty.label, { color: s.active ? t.ink : t.zinc, fontSize: 12.5 }]}>{s.title}</Text>
            <Text style={[ty.small, { color: t.sub, marginTop: 2 }]}>{s.body}</Text>
            <Text style={[ty.seg, { color: t.sub, fontSize: 9, marginTop: 4 }]}>{s.when}</Text>
          </View>
        ))}
      </View>
      <Card style={{ padding: space.lg, backgroundColor: t.accentSoft }}>
        <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_600SemiBold" }]}>
          Thanks for keeping listings honest — reports like yours are how the map stays true.
        </Text>
      </Card>
    </UiScreen>
  );
}
