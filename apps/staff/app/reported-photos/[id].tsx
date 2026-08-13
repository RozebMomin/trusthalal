import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";

import {
  ActionBar,
  Body,
  Button,
  Card,
  ErrorState,
  Field,
  Loading,
  Muted,
  Screen,
  SectionLabel,
} from "@/components/ui";
import { usePhotoReport, useResolvePhotoReport } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { relativeTime } from "@/lib/format";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

type Action = "uphold" | "dismiss" | null;

export default function ReportedPhotoDetail() {
  const t = useTheme();
  const router = useRouter();
  const authed = useAuth((s) => s.status) === "authed";
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = usePhotoReport(id);
  const resolve = useResolvePhotoReport();

  const [action, setAction] = useState<Action>(null);
  const [remove, setRemove] = useState(true);
  const [note, setNote] = useState("");

  if (!authed) return <Redirect href="/login" />;
  if (q.isLoading)
    return <View style={{ flex: 1, backgroundColor: t.bg }}><Loading /></View>;
  if (q.isError || !q.data)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState message="Couldn't load this photo." onRetry={() => void q.refetch()} />
      </View>
    );

  const p = q.data;

  async function submit() {
    try {
      await resolve.mutateAsync({
        photoId: p.photo_id,
        payload: {
          decision: action === "uphold" ? "UPHELD" : "DISMISSED",
          remove: action === "uphold" ? remove : false,
          resolution_note: note.trim() || null,
        },
      });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't submit", err instanceof Error ? err.message : "Try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen contentStyle={{ paddingTop: space.md }}>
        <Image
          source={{ uri: p.url }}
          style={{ width: "100%", height: 300, borderRadius: 16, backgroundColor: t.card2 }}
          resizeMode="cover"
        />
        <View>
          <Text style={{ ...ty.title, fontSize: 22, color: t.ink }}>{p.place_name ?? "Photo"}</Text>
          <Muted style={{ marginTop: 2 }}>
            By {p.uploader_display_name ?? "someone"} · added {relativeTime(p.created_at)}
          </Muted>
          {p.caption ? <Body style={{ marginTop: 8 }}>{p.caption}</Body> : null}
        </View>

        {p.review_body ? (
          <View>
            <SectionLabel>Attached to a review</SectionLabel>
            <Card>
              <Body>{p.review_body}</Body>
            </Card>
          </View>
        ) : null}

        <View>
          <SectionLabel>Reports ({p.reports.length})</SectionLabel>
          <Card>
            <Muted>{p.reports.length} report{p.reports.length === 1 ? "" : "s"} on file.</Muted>
          </Card>
        </View>
      </Screen>

      {action === null ? (
        <ActionBar>
          <Button title="Dismiss" variant="secondary" onPress={() => setAction("dismiss")} />
          <Button title="Uphold" variant="danger" onPress={() => setAction("uphold")} />
        </ActionBar>
      ) : (
        <ActionBar>
          <View style={{ flex: 1, gap: space.sm }}>
            {action === "uphold" ? (
              <Pressable
                onPress={() => setRemove((v) => !v)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: space.sm,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: remove ? t.danger : t.line,
                  backgroundColor: remove ? t.dangerSoft : "transparent",
                }}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    borderWidth: 2,
                    borderColor: remove ? t.danger : t.sub,
                    backgroundColor: remove ? t.danger : "transparent",
                  }}
                />
                <Text style={{ ...ty.body, color: t.ink }}>Remove the photo</Text>
              </Pressable>
            ) : null}
            <Field
              label={action === "uphold" ? "Note to uploader (shown if removed)" : "Note (optional)"}
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Add context…"
            />
            <View style={{ flexDirection: "row", gap: 9 }}>
              <Button title="Cancel" variant="secondary" onPress={() => { setAction(null); setNote(""); }} style={{ flex: 1 }} />
              <Button
                title={action === "uphold" ? "Uphold" : "Dismiss"}
                variant={action === "uphold" ? "danger" : "primary"}
                loading={resolve.isPending}
                onPress={submit}
                style={{ flex: 2 }}
              />
            </View>
          </View>
        </ActionBar>
      )}
    </View>
  );
}
