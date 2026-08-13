import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { Card, EmptyState, Loading, Muted, Screen } from "@/components/ui";
import { useIngestPlace, usePlaceAutocomplete } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export default function AddPlace() {
  const t = useTheme();
  const authed = useAuth((s) => s.status) === "authed";
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const results = usePlaceAutocomplete(debounced);
  const ingest = useIngestPlace();

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(h);
  }, [q]);

  if (!authed) return <Redirect href="/login" />;

  async function add(googlePlaceId: string) {
    try {
      const res = await ingest.mutateAsync(googlePlaceId);
      const msg = res.was_deleted
        ? `${res.place.name} was restored.`
        : res.existed
          ? `${res.place.name} is already in the catalog.`
          : `${res.place.name} added.`;
      Alert.alert(res.existed && !res.was_deleted ? "Already added" : "Done", msg);
    } catch (err) {
      Alert.alert("Couldn't add", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: t.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.line,
          paddingHorizontal: space.md,
        }}
      >
        <Feather name="search" size={18} color={t.sub} />
        <View style={{ flex: 1 }}>
          <TextInputBare value={q} onChangeText={setQ} placeholder="Search a restaurant on Google" />
        </View>
        {q.length > 0 ? (
          <Pressable onPress={() => setQ("")} hitSlop={8}>
            <Feather name="x" size={18} color={t.sub} />
          </Pressable>
        ) : null}
      </View>

      {debounced.trim().length < 3 ? (
        <Muted style={{ marginLeft: 4 }}>Type at least 3 characters.</Muted>
      ) : results.isLoading ? (
        <Loading />
      ) : !results.data || results.data.length === 0 ? (
        <EmptyState message="No matches. Try a different spelling or add the city." />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {results.data.map((p, i) => (
            <Pressable
              key={p.google_place_id}
              disabled={ingest.isPending}
              onPress={() => add(p.google_place_id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 13,
                borderBottomWidth: i === results.data.length - 1 ? 0 : 1,
                borderBottomColor: t.line,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: "600", color: t.ink }} numberOfLines={1}>
                  {p.primary_text ?? p.description}
                </Text>
                {p.secondary_text ? (
                  <Muted numberOfLines={1} style={{ marginTop: 2 }}>
                    {p.secondary_text}
                  </Muted>
                ) : null}
              </View>
              <Feather name="plus" size={20} color={t.accent} />
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function TextInputBare({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
}) {
  const t = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={t.sub}
      autoCorrect={false}
      autoCapitalize="words"
      returnKeyType="search"
      style={{ paddingVertical: 12, color: t.ink, ...ty.body }}
    />
  );
}
