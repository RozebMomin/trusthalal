import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api/client";
import { useForgotPassword } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";

/** Request a password-reset email. The link in the email opens the
 *  consumer web reset page; the user sets a new password there and comes
 *  back to sign in. Same "check your email" confirmation whether or not
 *  the address is registered (the API is silent by design). */
export default function ForgotPassword() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (forgot.isPending) return;
    setError(null);
    try {
      await forgot.mutateAsync({ email });
      setSent(true);
    } catch (e) {
      // The endpoint returns success for any real request; a thrown error
      // is a transport/5xx issue. Below 500 we still confirm (keeps the
      // no-enumeration contract); otherwise show a retry.
      if (e instanceof ApiError && e.status < 500) {
        setSent(true);
      } else {
        setError("Something went wrong. Try again in a moment.");
      }
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
      <Pressable accessibilityLabel="Back" onPress={() => router.back()}>
        <Text style={[ty.label, { color: t.sub }]}>✕</Text>
      </Pressable>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.accent, alignItems: "center", justifyContent: "center", marginTop: space.md }}>
        <Feather name="lock" size={20} color={t.onAccent} />
      </View>

      {sent ? (
        <>
          <Text style={[ty.title, { color: t.ink }]}>Check your email</Text>
          <Text style={[ty.body, { color: t.sub }]}>
            If an account exists for{" "}
            <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold" }}>{email}</Text>
            , we&rsquo;ve sent a link to reset your password. It expires in an
            hour. Open it, set a new password, then come back and sign in.
          </Text>
          <Button
            title="Back to sign in"
            variant="accent"
            onPress={() => router.replace("/(auth)/sign-in")}
          />
          <Pressable onPress={() => setSent(false)}>
            <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
              Used the wrong email?{" "}
              <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold" }}>Try again</Text>
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[ty.title, { color: t.ink }]}>Reset your password</Text>
          <Text style={[ty.body, { color: t.sub }]}>
            Enter your email and we&rsquo;ll send you a reset link.
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

          {error ? <Text style={[ty.small, { color: t.danger }]}>{error}</Text> : null}

          <Button
            title="Send reset link"
            variant="accent"
            loading={forgot.isPending}
            disabled={!email}
            onPress={submit}
          />
          <Pressable onPress={() => router.replace("/(auth)/sign-in")}>
            <Text style={[ty.small, { color: t.sub, textAlign: "center" }]}>
              Remembered it?{" "}
              <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold" }}>Back to sign in</Text>
            </Text>
          </Pressable>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
