import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api/client";
import { useLogin } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";

/** Email sign-in for v0. Sign in with Apple + Google land with the
 *  /auth/mobile/apple|google backend endpoints (see docs/api-and-auth.md)
 *  — required before App Store submission. */
export default function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      router.back();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "INVALID_CREDENTIALS"
          ? "Invalid email or password."
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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingTop: insets.top + space.lg,
        paddingHorizontal: space.lg,
        gap: space.md,
      }}
    >
      <Pressable accessibilityLabel="Close" onPress={() => router.back()}>
        <Text style={[ty.label, { color: t.sub }]}>✕</Text>
      </Pressable>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.accent, alignItems: "center", justifyContent: "center", marginTop: space.md }}>
        <Feather name="check" size={22} color={t.onAccent} />
      </View>
      <Text style={[ty.title, { color: t.ink }]}>Welcome back</Text>
      <Text style={[ty.body, { color: t.sub }]}>
        Sign in to save places and set your halal preferences.
      </Text>
      {/* Social sign-in per mockup 12 — backend endpoints land next build. */}
      <Button title=" Continue with Apple" onPress={() => setError("Apple sign-in arrives with the next build — use email for now.")} />
      <Button title="Continue with Google" variant="secondary" onPress={() => setError("Google sign-in arrives with the next build — use email for now.")} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
        <Text style={[ty.seg, { color: t.sub }]}>or</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
      </View>

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
      <View>
        <TextInput
          style={field}
          placeholder="Password"
          placeholderTextColor={t.sub}
          secureTextEntry={!show}
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          onPress={() => setShow((s) => !s)}
          style={{ position: "absolute", right: space.lg, top: 14 }}
        >
          <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>
            {show ? "Hide" : "Show"}
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push("/(auth)/forgot-password")}
        style={{ alignSelf: "flex-end" }}
      >
        <Text style={[ty.small, { color: t.sub, fontFamily: "Inter_600SemiBold" }]}>
          Forgot password?
        </Text>
      </Pressable>

      {error ? <Text style={[ty.small, { color: t.danger }]}>{error}</Text> : null}

      <Button
        title="Sign in"
        variant="accent"
        loading={login.isPending}
        disabled={!email || !password}
        onPress={submit}
      />
      <Pressable onPress={() => router.replace("/(auth)/sign-up")}>
        <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
          New here?{" "}
          <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold" }}>Create an account</Text>
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}
