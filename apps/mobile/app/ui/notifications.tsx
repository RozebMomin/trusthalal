import { Text, View } from "react-native";
import { Card, Cell, Seg } from "@/ui/kit";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "./_shared";

function Toggle({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View style={{ width: 40, height: 24, borderRadius: 999, backgroundColor: on ? t.accent : t.line, justifyContent: "center", alignItems: on ? "flex-end" : "flex-start", paddingHorizontal: 3 }}>
      <View style={{ width: 18, height: 18, borderRadius: 999, backgroundColor: "#fff" }} />
    </View>
  );
}
const RowT = ({ title, body, on }: { title: string; body: string; on: boolean }) => {
  const t = useTheme();
  return <Cell left={<View style={{flex:1}}><Text style={[ty.label,{color:t.ink,fontSize:12.5}]}>{title}</Text><Text style={[ty.small,{color:t.sub}]}>{body}</Text></View>} right={<Toggle on={on} />} last />;
};

export default function Notifications() {
  const t = useTheme();
  return (
    <UiScreen title="Notifications">
      <Seg>Your reports</Seg>
      <Card><RowT title="Dispute updates" body="Owner responses and outcomes" on /></Card>
      <Seg>Saved places</Seg>
      <Card>
        <Cell left={<View style={{flex:1}}><Text style={[ty.label,{color:t.ink,fontSize:12.5}]}>Status changes</Text><Text style={[ty.small,{color:t.sub}]}>A saved place gains or loses a tier</Text></View>} right={<Toggle on />} />
        <RowT title="Disputes opened" body="A saved place's profile gets questioned" on />
      </Card>
      <Seg>Verifier</Seg>
      <Card>
        <Cell left={<View style={{flex:1}}><Text style={[ty.label,{color:t.ink,fontSize:12.5}]}>Visit review results</Text><Text style={[ty.small,{color:t.sub}]}>Accepted, rejected, or needs changes</Text></View>} right={<Toggle on />} />
        <RowT title="Nearby unverified spots" body='"You&apos;re near a place that needs a visit"' on={false} />
      </Card>
      <Card style={{ padding: space.lg, backgroundColor: t.accentSoft }}>
        <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_600SemiBold" }]}>
          No marketing pushes. Ever. Every notification here is about something you did or something you saved.
        </Text>
      </Card>
    </UiScreen>
  );
}
