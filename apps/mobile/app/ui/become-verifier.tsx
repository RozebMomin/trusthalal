import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card, Cell } from "@/ui/kit";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "@/ui/screen-shell";

export default function BecomeVerifier() {
  const t = useTheme();
  return (
    <UiScreen>
      <View style={{ width: 48, height: 48, borderRadius: radii.lg, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
        <Feather name="shield" size={22} color="#fff" />
      </View>
      <Text style={[ty.title, { color: t.ink }]}>You eat out anyway.{"\n"}Make it count.</Text>
      <Text style={[ty.body, { color: t.sub }]}>
        Verifiers eat at halal spots and file short, honest reports. Your name backs the badge diners trust.
      </Text>
      <Card>
        <Cell left={<Text style={[ty.body, { color: t.ink }]}>🍽  One visit a month — that's it</Text>} />
        <Cell left={<Text style={[ty.body, { color: t.ink }]}>📝  10-minute report, filed from the table</Text>} />
        <Cell last left={<Text style={[ty.body, { color: t.ink }]}>🌍  Public profile you can link anywhere</Text>} />
      </Card>
      <Card style={{ padding: space.lg, backgroundColor: t.amberSoft }}>
        <Text style={[ty.label, { color: t.amber, fontSize: 11.5 }]}>The one non-negotiable</Text>
        <Text style={[ty.small, { color: t.amber, marginTop: 3 }]}>
          Every visit discloses who paid for the meal. Comped is fine. Hidden is not.
        </Text>
      </Card>
      <Button title="Apply — takes 5 minutes" variant="accent" onPress={() => {}} />
      <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>Applications reviewed by a human · usually within a week</Text>
    </UiScreen>
  );
}
