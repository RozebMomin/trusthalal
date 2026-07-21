import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api/client";
import { useLogin } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";
import { BrandMark } from "@/components/BrandMark";

/**
 * Email sign-in.
 *
 * Sign in with Apple and Google were laid out here ahead of the backend, as
 * two buttons that caught the tap and answered "arrives with the next
 * build". A control that exists and refuses is worse than one that doesn't:
 * it reads as broken rather than absent, and a reviewer following guideline
 * 2.1 sees a non-functional feature on the first screen behind an account.
 *
 * Removed rather than disabled, and the "or" divider with them — it existed
 * only to separate social auth from email, so with nothing above it, it
 * divided one thing. Reinstate both when /auth/mobile/apple|google exist
 * (docs/api-and-auth.md). Note that shipping Google sign-in without Apple's
 * is itself a guideline 4.8 problem, so they land together.
 */
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
      <Pressable accessibilityLabel="Close" onPress={() => router.back()}>
        <Text style={[ty.label, { color: t.sub }]}>✕</Text>
      </Pressable>
      <View style={{ marginTop: space.md }}>
        <BrandMark size={44} />
      </View>
      <Text style={[ty.title, { color: t.ink }]}>Welcome back</Text>
      <Text style={[ty.body, { color: t.sub }]}>
        Sign in to save places and set your halal preferences.
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
        {/* Same control as the one on delete-account: accentDeep because a
            grey "Show" doesn't read as tappable, hitSlop because the label
            is small, and a real label because "Show" alone tells a screen
            reader nothing about what it shows. */}
        <Pressable
          onPress={() => setShow((s) => !s)}
          accessibilityRole="button"
          accessibilityLabel={show ? "Hide password" : "Show password"}
          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
          style={{ position: "absolute", right: space.lg, top: 0, bottom: 0, justifyContent: "center" }}
        >
          <Text style={[ty.small, { color: t.accentDeep, fontFamily: "Inter_600SemiBold" }]}>
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
    </ScrollView>
  );
}
