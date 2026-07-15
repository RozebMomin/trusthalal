import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api/client";
import { useSignup } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";

export default function SignUp() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const signup = useSignup();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;

  async function submit() {
    setError(null);
    try {
      await signup.mutateAsync({ email, password, display_name: name.trim() });
      router.back();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "EMAIL_TAKEN"
          ? "An account with that email already exists — sign in instead."
          : "Something went wrong. Try again in a moment.",
      );
    }
  }

  const field = {
    backgroundColor: t.card,
    borderRadius: radii.lg,
    paddingHorizontal: space.lg,
    minHeight: 48,
    color: t.ink,
    ...ty.body,
  } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingHorizontal: space.lg,
        paddingBottom: space.xl,
        gap: space.md,
      }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Pressable accessibilityLabel="Back" onPress={() => router.back()}>
        <Text style={[ty.label, { color: t.sub }]}>‹ Back</Text>
      </Pressable>
      <Text style={[ty.title, { color: t.ink, marginTop: space.lg }]}>Create your account</Text>

      <TextInput
        style={field}
        placeholder="Your name"
        placeholderTextColor={t.sub}
        autoComplete="name"
        value={name}
        onChangeText={setName}
      />
      <Text style={[ty.small, { color: t.sub }]}>
        Shown on reports you file, so owners and reviewers know who's reporting.
      </Text>
      <TextInput
        style={field}
        placeholder="Email"
        placeholderTextColor={t.sub}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={field}
        placeholder="Password (8+ characters)"
        placeholderTextColor={t.sub}
        secureTextEntry
        autoComplete="new-password"
        value={password}
        onChangeText={setPassword}
      />
      <View style={{ flexDirection: "row", gap: 6 }}>
        <View style={{ backgroundColor: password.length >= 8 ? t.accentSoft : t.zincSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3.5 }}>
          <Text style={{ color: password.length >= 8 ? t.accentDeep : t.sub, fontFamily: "Inter_700Bold", fontSize: 9.5 }}>
            {password.length >= 8 ? "✓ " : ""}8+ characters
          </Text>
        </View>
      </View>
      {tooShort ? null : null}
      {error ? <Text style={[ty.small, { color: t.danger }]}>{error}</Text> : null}

      <Button
        title="Create account"
        variant="accent"
        loading={signup.isPending}
        disabled={!name.trim() || !email || password.length < 8}
        onPress={submit}
      />
      <View style={{ alignItems: "center" }}>
        <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
          We never sell your data or send marketing pushes.
        </Text>
      </View>
    </ScrollView>
  );
}
