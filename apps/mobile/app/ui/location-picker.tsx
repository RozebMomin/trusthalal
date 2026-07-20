import { Feather } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { Card, Cell, Chip, IcBox, SearchShell, Seg } from "@/ui/kit";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "@/ui/screen-shell";

export default function LocationPicker() {
  const t = useTheme();
  return (
    <UiScreen title="Where to?">
      <Card style={{ borderWidth: 1.5, borderColor: t.accentSoft }}>
        <Cell last left={<><IcBox icon="navigation" />
          <View><Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>Use my current location</Text>
          <Text style={[ty.small, { color: t.sub }]}>Asks the system for permission</Text></View></>}
          right={<Feather name="chevron-right" size={16} color={t.sub} />} />
      </Card>
      <SearchShell><Feather name="search" size={16} color={t.sub} />
        <Text style={[ty.body, { color: t.sub }]}>Any city, neighborhood, or address</Text></SearchShell>
      <Seg>Popular</Seg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {["New York","Chicago","Atlanta","Houston","Dearborn","Los Angeles","Dallas","Toronto"].map((c,i)=>(
          <Chip key={c} label={c} on={i===2} />))}
      </View>
      <Seg>Recent</Seg>
      <Card>
        <Cell left={<><Feather name="clock" size={15} color={t.sub} /><Text style={[ty.body,{color:t.ink}]}>Midtown, Atlanta</Text></>} right={<Text style={[ty.small,{color:t.sub}]}>2h ago</Text>} />
        <Cell last left={<><Feather name="clock" size={15} color={t.sub} /><Text style={[ty.body,{color:t.ink}]}>Dearborn, MI</Text></>} right={<Text style={[ty.small,{color:t.sub}]}>May 28</Text>} />
      </Card>
    </UiScreen>
  );
}
