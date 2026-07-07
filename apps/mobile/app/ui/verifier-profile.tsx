import { Text, View } from "react-native";
import { FIXTURE_VERIFIER } from "@/fixtures";
import { Card, Tag } from "@/ui/kit";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "./_shared";

export default function VerifierProfile() {
  const t = useTheme();
  const v = FIXTURE_VERIFIER;
  return (
    <UiScreen>
      <View style={{ alignItems: "center", gap: 8 }}>
        <View style={{ width: 72, height: 72, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 26 }}>A</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Text style={[ty.h2, { color: t.ink }]}>{v.handle}</Text><Tag label="✓ VERIFIER" tone="solid" />
        </View>
        <Text style={[ty.small, { color: t.sub, textAlign: "center", paddingHorizontal: 14 }]}>{v.bio}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[[String(v.visits), "Visits"], [String(v.cities), "Cities"], [v.since, "Since"]].map(([n, l]) => (
          <Card key={l} style={{ flex: 1, padding: space.md, alignItems: "center" }}>
            <Text style={[ty.h2, { color: t.ink, fontSize: 16 }]}>{n}</Text>
            <Text style={[ty.seg, { color: t.sub, fontSize: 8.5 }]}>{l}</Text>
          </Card>
        ))}
      </View>
      {[["Karachi Grill House", '"Cert on the wall, zabihah confirmed with the kitchen…"'], ["Al-Noor Shawarma", '"Fully halal menu, supplier receipts shown…"']].map(([name, quote]) => (
        <Card key={name} style={{ padding: space.lg }}>
          <Text style={[ty.label, { color: t.ink, fontSize: 12.5 }]}>{name}</Text>
          <Text style={[ty.small, { color: t.sub }]}>May 2026 · meal self-paid</Text>
          <Text style={[ty.small, { color: t.zinc, marginTop: 3 }]}>{quote}</Text>
        </Card>
      ))}
      <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>Every visit discloses who paid for the meal.</Text>
    </UiScreen>
  );
}
