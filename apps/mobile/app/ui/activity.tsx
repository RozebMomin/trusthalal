import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { FIXTURE_ACTIVITY } from "@/fixtures";
import { Chip, IcBox } from "@/ui/kit";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "@/ui/screen-shell";

export default function Activity() {
  const t = useTheme();
  return (
    <UiScreen title="Activity">
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Chip label="All" on /><Chip label="Disputes" ghost /><Chip label="Saved" ghost /><Chip label="Verifier" ghost />
      </View>
      {FIXTURE_ACTIVITY.map((a) => (
        <View key={a.title} style={{ backgroundColor: t.card, borderRadius: 20, padding: space.lg, flexDirection: "row", gap: 11, opacity: a.unread ? 1 : 0.7 }}>
          <IcBox icon={a.icon as never} bg={t.accentSoft} fg={t.accentDeep} />
          <View style={{ flex: 1 }}>
            <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>{a.title}</Text>
            <Text style={[ty.small, { color: t.sub, marginTop: 3 }]}>{a.body}</Text>
            <Text style={[ty.seg, { color: t.sub, fontSize: 9, marginTop: 5 }]}>{a.when}</Text>
          </View>
          {a.unread ? <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: t.accent, marginTop: 4 }} /> : null}
        </View>
      ))}
      <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>No marketing pushes. Ever.</Text>
    </UiScreen>
  );
}
