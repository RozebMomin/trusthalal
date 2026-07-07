import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { Card, Cell, Chip, SearchShell, Seg, Tag } from "@/ui/kit";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "./_shared";

const ROWS = [
  { name: "Kabab King", meta: "Afghan · 2.1 mi", tag: <Tag label="NO INFO" tone="dashed" /> },
  { name: "Sabri Kabab House", meta: "Indian · 3.4 mi", tag: <Tag label="CERTIFIED" tone="amber" /> },
  { name: "Shalimar Kabab", meta: "Pakistani · 4.8 mi", tag: <Tag label="✓ VERIFIED" tone="solid" /> },
];

export default function SearchTyping() {
  const t = useTheme();
  return (
    <UiScreen>
      <SearchShell>
        <Feather name="search" size={16} color={t.ink} />
        <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_600SemiBold" }]}>kabab</Text>
        <View style={{ flex: 1 }} /><Feather name="x" size={15} color={t.sub} />
      </SearchShell>
      <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>Searching within 5 mi of Midtown, Atlanta</Text>
      <Card>
        {ROWS.map((r, i) => (
          <Cell key={r.name} last={i === ROWS.length - 1}
            left={<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: t.zincSoft }} />
              <View><Text style={[ty.label, { color: t.ink, fontSize: 12.5 }]}>{r.name}</Text>
              <Text style={[ty.small, { color: t.sub }]}>{r.meta}</Text></View></View>}
            right={r.tag} />
        ))}
      </Card>
      <Seg>Recent searches</Seg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label="mandi" ghost icon="clock" /><Chip label="halal burger" ghost icon="clock" /><Chip label="Saffron Yemeni" ghost icon="clock" />
      </View>
      <Seg>Try</Seg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label="Open now" /><Chip label="✓ Verified only" /><Chip label="Zabihah" />
      </View>
    </UiScreen>
  );
}
