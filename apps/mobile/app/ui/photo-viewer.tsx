import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space, type as ty } from "@/lib/theme";

const HERO = "https://images.unsplash.com/photo-1544025162-d76694265947?w=1200";

export default function PhotoViewer() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <Image source={{ uri: HERO }} style={{ flex: 1 }} resizeMode="contain" />
      <Pressable onPress={() => router.back()} accessibilityLabel="Close"
        style={{ position: "absolute", top: insets.top + 8, left: 16, width: 36, height: 36, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
        <Feather name="x" size={18} color="#fff" />
      </Pressable>
      <Text style={{ position: "absolute", top: insets.top + 16, right: 18, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_700Bold", fontSize: 12 }}>3 / 12</Text>
      <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.lg, backgroundColor: "#000", gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 9, alignItems: "center" }}>
          <View style={{ width: 28, height: 28, borderRadius: 999, backgroundColor: "#059669", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 10 }}>A</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[ty.small, { color: "#fff", fontFamily: "Inter_600SemiBold" }]}>@amira.eats · <Text style={{ color: "#34D399" }}>verifier visit</Text></Text>
            <Text style={[ty.small, { color: "rgba(255,255,255,0.5)", fontSize: 10 }]}>"Supplier invoice for the chicken — Crescent Foods" · May 2026</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 5 }}>
          {[1, 0.5, 0.5, 0.5].map((o, i) => (
            <View key={i} style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: "#333", opacity: o, borderWidth: i === 0 ? 2 : 0, borderColor: "#34D399" }} />
          ))}
        </View>
      </View>
    </View>
  );
}
