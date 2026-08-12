import { Redirect } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Body, Button, Field, H1, Muted, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-store";
import { space } from "@/lib/theme";

export default function LoginScreen() {
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
    <Screen>
      <View style={{ gap: space.xs, marginTop: space.xxl, marginBottom: space.lg }}>
        <H1>Staff sign in</H1>
        <Muted>Use your Trust Halal admin account.</Muted>
      </View>

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
        placeholder="••••••••"
      />

      {error ? (
        <Body style={{ color: "#E02424" }}>{error}</Body>
      ) : null}

      <View style={{ marginTop: space.md }}>
        <Button
          title="Sign in"
          onPress={submit}
          loading={busy}
          disabled={!email || !password}
        />
      </View>
    </Screen>
  );
}
