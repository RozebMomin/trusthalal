import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card, Cell, Chip, IcBox, Seg, Steps, Tag } from "@/ui/kit";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { UiScreen } from "./_shared";

/** Mockups 19–22 in one route, stepped. UI only. */
export default function VisitFlow() {
  const t = useTheme();
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, 4));

  return (
    <UiScreen>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_700Bold" }]}>{step === 4 ? "" : "Cancel"}</Text>
        <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>{step < 4 ? `Step ${step + 1} of 5` : ""}</Text>
      </View>
      {step < 4 ? <Steps total={5} done={step + 1} /> : null}

      {step === 0 && (<>
        <Text style={[ty.title, { color: t.ink }]}>Where are you{"\n"}eating?</Text>
        <Card style={{ borderWidth: 2, borderColor: t.accent, padding: space.lg }}>
          <View style={{ flexDirection: "row", gap: 11, alignItems: "center" }}>
            <IcBox icon="map-pin" bg={t.accentSoft} fg={t.accentDeep} />
            <View style={{ flex: 1 }}>
              <Text style={[ty.label, { color: t.ink, fontSize: 13.5 }]}>Karachi Grill House</Text>
              <Text style={[ty.small, { color: t.sub }]}>You're here · 40 ft away</Text>
            </View>
            <Feather name="check-circle" size={20} color={t.accent} />
          </View>
        </Card>
        {["Saffron Yemeni Kitchen · 0.3 mi", "Bosphorus Grill · 0.6 mi"].map((x) => (
          <Card key={x} style={{ padding: space.lg }}><Text style={[ty.body, { color: t.zinc }]}>{x}</Text></Card>
        ))}
        <Text style={[ty.small, { color: t.accentDeep, textAlign: "center", fontFamily: "Inter_600SemiBold" }]}>Restaurant not in the catalog yet? Suggest it →</Text>
        <Button title="Continue" onPress={next} />
      </>)}

      {step === 1 && (<>
        <Text style={[ty.title, { color: t.ink }]}>Snap it while{"\n"}you're there.</Text>
        <Text style={[ty.body, { color: t.sub }]}>
          Photos are your evidence — the cert on the wall, the menu, your meal. Camera first; add from your library too.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <View style={{ width: 100, height: 100, borderRadius: radii.lg, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 2, borderColor: t.accent }}>
            <Feather name="camera" size={22} color={t.accentDeep} />
            <Text style={[ty.seg, { color: t.accentDeep, fontSize: 8.5 }]}>Camera</Text>
          </View>
          {["CERT", "MENU", "MEAL"].map((l) => (
            <View key={l} style={{ width: 100, height: 100, borderRadius: radii.lg, backgroundColor: t.zincSoft, alignItems: "flex-start", justifyContent: "flex-end", padding: 6 }}>
              <Tag label={l} tone="glass" />
            </View>
          ))}
          <View style={{ width: 100, height: 100, borderRadius: radii.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: t.line, alignItems: "center", justifyContent: "center" }}>
            <Feather name="image" size={18} color={t.sub} />
          </View>
        </View>
        <Text style={[ty.small, { color: t.sub }]}>3 photos attached · aim for the cert, the menu, and what you ordered.</Text>
        <Button title="Continue" onPress={next} />
        <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>Photos stay on-device until you submit.</Text>
      </>)}

      {step === 2 && (<>
        <Text style={[ty.title, { color: t.ink }]}>What did you{"\n"}observe?</Text>
        <Seg>You ordered</Seg>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <Chip label="Chicken boti" on /><Chip label="Lamb chops" on /><Chip label="+ Add item" ghost />
        </View>
        <Seg>Checks</Seg>
        <Card>
          <Cell left={<Text style={[ty.small,{color:t.ink,fontSize:12.5}]}>Halal cert visible on premises</Text>} right={<Tag label="YES" tone="wash" />} />
          <Cell left={<Text style={[ty.small,{color:t.ink,fontSize:12.5}]}>Menu is fully halal</Text>} right={<Tag label="YES" tone="wash" />} />
          <Cell left={<Text style={[ty.small,{color:t.ink,fontSize:12.5}]}>Alcohol on premises</Text>} right={<Tag label="NO" tone="wash" />} />
          <Cell last left={<Text style={[ty.small,{color:t.ink,fontSize:12.5}]}>Staff confirmed sourcing</Text>} right={<Tag label="PARTIAL" tone="amber" />} />
        </Card>
        <Seg>Notes</Seg>
        <Card style={{ padding: space.lg, minHeight: 70 }}>
          <Text style={[ty.body, { color: t.zinc }]}>Kitchen manager showed the supplier invoice for the chicken — Crescent Foods…</Text>
        </Card>
        <Button title="Continue" onPress={next} />
        <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>Draft auto-saves on device</Text>
      </>)}

      {step === 3 && (<>
        <Text style={[ty.title, { color: t.ink }]}>Who paid for{"\n"}the meal?</Text>
        <Text style={[ty.body, { color: t.sub }]}>Nothing here disqualifies your visit — hiding it does. This is shown on the public report.</Text>
        {["I paid for it myself", "The restaurant comped it", "Paid partnership", "Something else"].map((o, i) => (
          <Card key={o} style={{ padding: space.lg, borderWidth: i === 0 ? 2 : 0, borderColor: t.accent }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[ty.label, { color: i === 0 ? t.ink : t.zinc, fontSize: 13.5 }]}>{o}</Text>
              {i === 0
                ? <View style={{ width: 20, height: 20, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}><Feather name="check" size={12} color="#fff" /></View>
                : <View style={{ width: 20, height: 20, borderRadius: 999, borderWidth: 2, borderColor: t.line }} />}
            </View>
          </Card>
        ))}
        <View style={{ flexDirection: "row", gap: 8, backgroundColor: t.accentSoft, borderRadius: radii.md, padding: space.md }}>
          <Feather name="shield" size={15} color={t.accentDeep} />
          <Text style={[ty.small, { color: t.accentDeep, flex: 1, fontFamily: "Inter_600SemiBold" }]}>
            Karachi Grill House · 4 photos attached · draft saved on device — syncs when online
          </Text>
        </View>
        <Button title="Review & submit" onPress={next} />
      </>)}

      {step === 4 && (
        <View style={{ alignItems: "center", gap: space.md, paddingTop: 60 }}>
          <View style={{ width: 88, height: 88, borderRadius: 999, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
            <Feather name="check" size={40} color="#fff" />
          </View>
          <Text style={[ty.title, { color: t.ink, textAlign: "center" }]}>Report submitted</Text>
          <Text style={[ty.body, { color: t.sub, textAlign: "center" }]}>
            Trust Halal reviews every visit. You'll get a notification when it's accepted — usually within a few days.
          </Text>
          <Card style={{ padding: space.lg, alignSelf: "stretch" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>Karachi Grill House</Text>
              <Tag label="IN REVIEW" tone="amber" />
            </View>
          </Card>
          <Text style={[ty.label, { color: t.accentDeep, fontSize: 12 }]}>That's 13 visits — thank you. 🤲</Text>
          <View style={{ alignSelf: "stretch" }}><Button title="Done" onPress={() => setStep(0)} /></View>
        </View>
      )}
    </UiScreen>
  );
}
