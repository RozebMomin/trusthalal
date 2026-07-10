import { Text, View } from "react-native";
import { Card, Cell, Chip, Seg, Tag } from "@/ui/kit";
import { type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "@/ui/screen-shell";

const R = ({l,v,tone}:{l:string;v:string;tone?:"wash"|"zinc"}) => {
  const t = useTheme();
  return <Cell left={<Text style={[ty.small,{color:t.sub,fontSize:12.5}]}>{l}</Text>} right={<Tag label={v} tone={tone ?? "wash"} />} />;
};

export default function TrustProfile() {
  const t = useTheme();
  return (
    <UiScreen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Tag label="✓ VERIFIED HALAL" tone="solid" /><Text style={[ty.small,{color:t.sub}]}>since May 2026</Text>
      </View>
      <Text style={[ty.title, { color: t.ink }]}>Trust profile</Text>
      <Seg>Sourcing · per meat</Seg>
      <Card>
        <R l="Chicken" v="ZABIHAH · CRESCENT" /><R l="Beef" v="ZABIHAH" /><R l="Lamb" v="ZABIHAH · LOCAL" />
        <Cell last left={<Text style={[ty.small,{color:t.sub,fontSize:12.5}]}>Pork</Text>} right={<Tag label="NOT SERVED" tone="zinc" />} />
      </Card>
      <Seg>Kitchen</Seg>
      <Card>
        <Cell left={<Text style={[ty.small,{color:t.sub,fontSize:12.5}]}>Menu coverage</Text>} right={<Text style={[ty.label,{color:t.ink,fontSize:12}]}>Fully halal</Text>} />
        <Cell left={<Text style={[ty.small,{color:t.sub,fontSize:12.5}]}>Alcohol served</Text>} right={<Text style={[ty.label,{color:t.ink,fontSize:12}]}>None</Text>} />
        <Cell last left={<Text style={[ty.small,{color:t.sub,fontSize:12.5}]}>Alcohol in cooking</Text>} right={<Text style={[ty.label,{color:t.ink,fontSize:12}]}>No</Text>} />
      </Card>
      <Seg>Certificate</Seg>
      <Card>
        <Cell last left={<View><Text style={[ty.label,{color:t.ink,fontSize:13}]}>IFANCA</Text><Text style={[ty.small,{color:t.sub}]}>#IF-2841 · expires Mar 2027</Text></View>} right={<Chip label="View cert" ghost />} />
      </Card>
      <Seg>Verification history</Seg>
      <Card>
        <Cell left={<Text style={[ty.small,{color:t.ink,fontSize:12}]}>Visit by <Text style={{fontFamily:"Inter_700Bold"}}>@amira.eats</Text></Text>} right={<Text style={[ty.small,{color:t.sub}]}>May 2026</Text>} />
        <Cell last left={<Text style={[ty.small,{color:t.ink,fontSize:12}]}>Owner claim approved</Text>} right={<Text style={[ty.small,{color:t.sub}]}>Feb 2026</Text>} />
      </Card>
    </UiScreen>
  );
}
