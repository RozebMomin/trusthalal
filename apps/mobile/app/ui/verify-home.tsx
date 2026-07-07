import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card, Cell, Chip, Seg, Tag } from "@/ui/kit";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "./_shared";

const Stat = ({ n, l }: { n: string; l: string }) => {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, padding: space.md, alignItems: "center" }}>
      <Text style={[ty.h2, { color: t.ink }]}>{n}</Text>
      <Text style={[ty.seg, { color: t.sub, fontSize: 8.5, marginTop: 2 }]}>{l}</Text>
    </Card>
  );
};

export default function VerifyHome() {
  const t = useTheme();
  return (
    <UiScreen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={[ty.title, { color: t.ink }]}>Verify</Text>
        <Tag label="✓ @AMIRA.EATS" tone="solid" />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat n="12" l="Accepted" /><Stat n="1" l="In review" /><Stat n="8" l="Cities" />
      </View>
      <Card style={{ padding: space.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: t.line, backgroundColor: t.bg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Tag label="DRAFT · OFFLINE" tone="amber" />
            <Text style={[ty.label, { color: t.ink, marginTop: 6 }]}>Karachi Grill House</Text>
            <Text style={[ty.small, { color: t.sub }]}>Step 4 of 5 · 4 photos · saved 6:12 PM</Text>
          </View>
          <Chip label="Resume" on />
        </View>
      </Card>
      <Button title="File a visit" variant="accent" onPress={() => {}} />
      <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>We'll suggest the place you're standing in.</Text>
      <Seg>My visits</Seg>
      <Card>
        <Cell left={<View><Text style={[ty.label,{color:t.ink,fontSize:12.5}]}>Al-Noor Shawarma</Text><Text style={[ty.small,{color:t.sub}]}>Dearborn · May 12</Text></View>} right={<Tag label="ACCEPTED" tone="wash" />} />
        <Cell left={<View><Text style={[ty.label,{color:t.ink,fontSize:12.5}]}>Saffron Yemeni Kitchen</Text><Text style={[ty.small,{color:t.sub}]}>Atlanta · Jun 2</Text></View>} right={<Tag label="IN REVIEW" tone="amber" />} />
        <Cell last left={<View><Text style={[ty.label,{color:t.ink,fontSize:12.5}]}>Bosphorus Grill</Text><Text style={[ty.small,{color:t.sub}]}>Atlanta · Apr 20</Text></View>} right={<Tag label="WITHDRAWN" tone="zinc" />} />
      </Card>
    </UiScreen>
  );
}
