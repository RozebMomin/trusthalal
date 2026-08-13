import { Redirect } from "expo-router";
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-store";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export default function LoginScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const status = useAuth((s) => s.status);
  const login = useAuth((s) => s.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authed") return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        paddingHorizontal: 30,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + space.lg,
        justifyContent: "center",
      }}
    >
      <View style={{ alignItems: "center", marginBottom: space.xl, gap: space.lg }}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require("../assets/icon.png")}
          style={{ width: 76, height: 76, borderRadius: 18 }}
        />
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ ...ty.title, fontSize: 24, color: t.ink }}>Staff console</Text>
          <Text style={{ ...ty.body, color: t.sub }}>Sign in with your admin account.</Text>
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          placeholder="you@trusthalal.org"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          placeholder="Your password"
        />
        {error ? (
          <Text style={{ ...ty.small, color: t.danger }}>{error}</Text>
        ) : null}
        <Button
          title="Sign in"
          onPress={submit}
          loading={busy}
          disabled={!email || !password}
          style={{ marginTop: space.xs }}
        />
      </View>
    </View>
  );
}
