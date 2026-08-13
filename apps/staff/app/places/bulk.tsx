import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import {
  Button,
  Card,
  EmptyState,
  Loading,
  Muted,
  Pill,
  Screen,
  SectionLabel,
} from "@/components/ui";
import {
  useBulkImportPlaces,
  useBulkPreviewPlaces,
  usePlaceAutocomplete,
} from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import type { PlaceBulkPreviewStatus } from "@/lib/api/types";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Staged = { id: string; label: string };

const STATUS_META: Record<PlaceBulkPreviewStatus, { label: string; tone: "green" | "neutral" | "amber" }> = {
  NEW: { label: "New", tone: "green" },
  EXISTS: { label: "Exists", tone: "neutral" },
  SOFT_DELETED: { label: "Deleted", tone: "amber" },
};

export default function BulkAdd() {
  const t = useTheme();
  const authed = useAuth((s) => s.status) === "authed";

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [preview, setPreview] = useState<Record<string, PlaceBulkPreviewStatus>>({});

  const results = usePlaceAutocomplete(debounced);
  const previewM = useBulkPreviewPlaces();
  const importM = useBulkImportPlaces();

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(h);
  }, [q]);

  if (!authed) return <Redirect href="/login" />;

  function stage(id: string, label: string) {
    setStaged((s) => (s.some((x) => x.id === id) ? s : [...s, { id, label }]));
    setPreview({});
    setQ("");
    setDebounced("");
  }
  function unstage(id: string) {
    setStaged((s) => s.filter((x) => x.id !== id));
    setPreview({});
  }

  async function runPreview() {
    try {
      const res = await previewM.mutateAsync(staged.map((s) => s.id));
      const map: Record<string, PlaceBulkPreviewStatus> = {};
      for (const it of res.items) map[it.google_place_id] = it.status;
      setPreview(map);
    } catch (err) {
      Alert.alert("Preview failed", err instanceof Error ? err.message : "Try again.");
    }
  }

  async function runImport() {
    try {
      const res = await importM.mutateAsync(staged.map((s) => s.id));
      const s = res.summary;
      Alert.alert(
        "Import complete",
        `${s.created} added, ${s.existed} already there, ${s.soft_deleted} restored${s.failed ? `, ${s.failed} failed` : ""}.`,
      );
      setStaged([]);
      setPreview({});
    } catch (err) {
      Alert.alert("Import failed", err instanceof Error ? err.message : "Try again.");
    }
  }

  const busy = previewM.isPending || importM.isPending;

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
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search and add restaurants"
          placeholderTextColor={t.sub}
          autoCorrect={false}
          autoCapitalize="words"
          style={{ flex: 1, paddingVertical: 12, color: t.ink, ...ty.body }}
        />
      </View>

      {debounced.trim().length >= 3 ? (
        results.isLoading ? (
          <Loading />
        ) : results.data && results.data.length > 0 ? (
          <Card padded={false} style={{ paddingHorizontal: space.lg }}>
            {results.data.map((p, i) => {
              const already = staged.some((x) => x.id === p.google_place_id);
              return (
                <Pressable
                  key={p.google_place_id}
                  disabled={already}
                  onPress={() => stage(p.google_place_id, p.primary_text ?? p.description)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 12,
                    borderBottomWidth: i === results.data.length - 1 ? 0 : 1,
                    borderBottomColor: t.line,
                    opacity: already ? 0.5 : 1,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: "600", color: t.ink }} numberOfLines={1}>
                      {p.primary_text ?? p.description}
                    </Text>
                    {p.secondary_text ? (
                      <Muted numberOfLines={1} style={{ marginTop: 2 }}>{p.secondary_text}</Muted>
                    ) : null}
                  </View>
                  <Feather name={already ? "check" : "plus"} size={20} color={t.accent} />
                </Pressable>
              );
            })}
          </Card>
        ) : (
          <EmptyState message="No matches." />
        )
      ) : null}

      <SectionLabel>Staged ({staged.length})</SectionLabel>
      {staged.length === 0 ? (
        <Card>
          <Muted>Search above to stage restaurants, then preview and import.</Muted>
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {staged.map((s, i) => {
            const st = preview[s.id];
            return (
              <View
                key={s.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 12,
                  borderBottomWidth: i === staged.length - 1 ? 0 : 1,
                  borderBottomColor: t.line,
                }}
              >
                <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>
                  {s.label}
                </Text>
                {st ? <Pill label={STATUS_META[st].label} tone={STATUS_META[st].tone} /> : null}
                <Pressable onPress={() => unstage(s.id)} hitSlop={8}>
                  <Feather name="x" size={18} color={t.sub} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      {staged.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 9, marginTop: space.xs }}>
          <Button title="Preview" variant="secondary" loading={previewM.isPending} onPress={runPreview} style={{ flex: 1 }} />
          <Button
            title={`Import ${staged.length}`}
            variant="primary"
            loading={importM.isPending}
            disabled={busy}
            onPress={runImport}
            style={{ flex: 1 }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
