import { router } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api/client";
import { useSignup } from "@/lib/api/hooks";
import { PASSWORD_RULES, isPasswordValid } from "@/lib/password-policy";
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
  // Reveal toggle. This matters more here than on sign-in: you're inventing
  // a password against four visible rules, and without this the only way to
  // tell why a rule hasn't gone green is to guess at what you typed.
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordOk = isPasswordValid(password);

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
      <View>
        <TextInput
          // Right padding clears the toggle so a long password doesn't run
          // underneath it.
          style={[field, { paddingRight: 68 }]}
          placeholder="Password"
          placeholderTextColor={t.sub}
          secureTextEntry={!show}
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
        />
        {/* Same control as sign-in and delete-account. */}
        <Pressable
          onPress={() => setShow((v) => !v)}
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {PASSWORD_RULES.map((rule) => {
          const met = rule.ok(password);
          const bg = met ? t.accentSoft : t.zincSoft;
          const fg = met ? t.accentDeep : t.sub;
          return (
            <View key={rule.label} style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3.5 }}>
              <Text style={{ color: fg, fontFamily: "Inter_700Bold", fontSize: 9.5 }}>
                {met ? "✓ " : ""}{rule.label}
              </Text>
            </View>
          );
        })}
      </View>
      {error ? <Text style={[ty.small, { color: t.danger }]}>{error}</Text> : null}

      {/* Guideline 1.2 requires users of an app hosting user-generated
          content to agree to terms that state there is no tolerance for
          objectionable content or abusive users. Pressing the button below
          IS that agreement, so the sentence sits above it — in reading
          order, and in VoiceOver's focus order, before the action rather
          than after it. Consumer and owner place it the same way.

          Not the "we never sell your data" line, which stays under the
          button: that is reassurance about what happens next, not a term
          being agreed to, and putting it up here would dilute the sentence
          that has a job. */}
      <Text style={[ty.small, { color: t.sub, textAlign: "center", lineHeight: 18 }]}>
        By creating an account you agree to our{" "}
        <Text
          style={{ color: t.accentDeep, fontFamily: "Inter_600SemiBold" }}
          onPress={() => Linking.openURL("https://trusthalal.org/terms")}
        >
          Terms of Service
        </Text>{" "}
        and{" "}
        <Text
          style={{ color: t.accentDeep, fontFamily: "Inter_600SemiBold" }}
          onPress={() => Linking.openURL("https://trusthalal.org/privacy")}
        >
          Privacy Policy
        </Text>
        .
      </Text>

      <Button
        title="Create account"
        variant="accent"
        loading={signup.isPending}
        disabled={!name.trim() || !email || !passwordOk}
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
