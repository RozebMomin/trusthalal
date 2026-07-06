import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser, useMyFavorites } from "@/lib/api/hooks";
import { space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { PlaceCard } from "@/components/PlaceCard";
import { EmptyState, ErrorState, Loading } from "@/components/States";

export default function Saved() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const favorites = useMyFavorites(Boolean(me));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + space.sm }}>
      <Text style={[ty.title, { color: t.ink, paddingHorizontal: space.lg }]}>Saved</Text>
      {meLoading ? (
        <Loading />
      ) : !me ? (
        <EmptyState
          title="Keep a list you can trust"
          body="Save places and take your list with you. Sign in or create a free account to start saving."
          actionTitle="Sign in"
          onAction={() => router.push("/(auth)/sign-in")}
        />
      ) : favorites.isLoading ? (
        <Loading />
      ) : favorites.error ? (
        <ErrorState
          message="We couldn't load your saved places."
          onRetry={() => favorites.refetch()}
        />
      ) : (favorites.data ?? []).length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Tap Save on any restaurant and it'll be waiting for you here."
        />
      ) : (
        <FlatList
          data={favorites.data}
          keyExtractor={(f) => f.place.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 32 }}
          renderItem={({ item }) => <PlaceCard place={item.place} />}
        />
      )}
    </View>
  );
}
