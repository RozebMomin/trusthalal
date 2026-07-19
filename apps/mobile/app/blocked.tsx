/**
 * People you've blocked.
 *
 * Exists because a block you can't find and undo is a trap rather than a
 * feature. App Store guideline 1.2 requires the ability to block; leaving no
 * way back would satisfy the letter of it and be its own kind of broken —
 * people block in a bad moment and change their mind.
 *
 * Deliberately plain. There's nothing to configure here and no reason to make
 * the list feel like a management console; it's a list of names and a way out.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCurrentUser, useMyBlocks, useUnblockUser } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card } from "@/ui/kit";

export default function BlockedScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const blocks = useMyBlocks(Boolean(me));
  const unblock = useUnblockUser();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + space.xl,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={22} color={t.ink} />
        </Pressable>
        <Text style={[ty.title, { color: t.ink, fontSize: 22 }]}>Blocked</Text>
      </View>

      <Text style={[ty.small, { color: t.sub, marginBottom: space.sm, lineHeight: 18 }]}>
        You don&apos;t see reviews from these people. They haven&apos;t been
        told, and blocking them doesn&apos;t report them to us — if something
        broke our guidelines, report it too.
      </Text>

      {blocks.isLoading ? (
        <ActivityIndicator style={{ marginTop: space.xl }} color={t.accentDeep} />
      ) : null}

      {blocks.data && blocks.data.length === 0 ? (
        <Card>
          <View style={{ padding: space.lg }}>
            <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
              You haven&apos;t blocked anyone. You can block someone from the
              report option on any review.
            </Text>
          </View>
        </Card>
      ) : null}

      {(blocks.data ?? []).map((b) => (
        <View
          key={b.user_id}
          style={{
            backgroundColor: t.card,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: t.line,
            padding: space.md,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Text style={[ty.label, { color: t.ink, fontSize: 14, flex: 1 }]}>
            {b.display_name ?? "A diner"}
          </Text>
          <Pressable
            onPress={() => unblock.mutate(b.user_id)}
            disabled={unblock.isPending}
            hitSlop={8}
            style={{
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: radii.md,
              paddingVertical: 7,
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: t.ink, fontFamily: "Inter_600SemiBold", fontSize: 12.5 }}>
              Unblock
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
