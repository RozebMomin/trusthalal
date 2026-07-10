import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card, Chip, Seg } from "@/ui/kit";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "@/ui/screen-shell";

export default function ReportIssue() {
  const t = useTheme();
  return (
    <UiScreen title="Report an issue">
      <Text style={[ty.small, { color: t.sub }]}>Karachi Grill House · goes to the owner and Trust Halal reviewers. You'll get updates in Activity.</Text>
      <Seg>What's wrong?</Seg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {["Pork served","Alcohol served","Menu coverage wrong","Sourcing wrong","Cert invalid","Closed","Other"].map((c,i)=>(
          <Chip key={c} label={c} ghost on={i===1} />))}
      </View>
      <Seg>What did you see?</Seg>
      <Card style={{ padding: space.lg, minHeight: 76 }}>
        <Text style={[ty.body, { color: t.zinc }]}>Beer list on the table and a bar in the back — visited Friday evening, June 26.</Text>
      </Card>
      <Seg>Evidence · optional</Seg>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ width: 62, height: 62, borderRadius: radii.md, backgroundColor: t.dangerSoft }} />
        <View style={{ width: 62, height: 62, borderRadius: radii.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: t.line, alignItems: "center", justifyContent: "center", gap: 2 }}>
          <Feather name="camera" size={16} color={t.sub} />
          <Text style={[ty.seg, { color: t.sub, fontSize: 8 }]}>Camera</Text>
        </View>
      </View>
      <Button title="Submit report" onPress={() => {}} />
      <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>Your name is shown to reviewers and the owner.</Text>
    </UiScreen>
  );
}
