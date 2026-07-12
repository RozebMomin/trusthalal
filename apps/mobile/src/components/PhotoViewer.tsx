import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PlacePhoto } from "@/lib/api/types";

/** Human label per upload source — mirrors the mockup's "verifier visit" credit. */
const SOURCE_LABEL: Record<string, string> = {
  OWNER: "owner photo",
  VERIFIER: "verifier visit",
  CONSUMER: "community photo",
};

/**
 * Full-screen, swipeable photo viewer. Rendered as a Modal over the place
 * detail screen; reads real `place.photos` (url + credit + caption).
 */
export function PhotoViewer({
  photos,
  initialIndex,
  onClose,
}: {
  photos: PlacePhoto[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<PlacePhoto>>(null);
  const [index, setIndex] = useState(initialIndex);
  const current = photos[index];

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(p) => p.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
          }
          renderItem={({ item }) => (
            <Image source={{ uri: item.url }} style={{ width, height }} resizeMode="contain" />
          )}
        />

        {/* Close */}
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close photos"
          style={{
            position: "absolute", top: insets.top + 8, left: 16, width: 36, height: 36,
            borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center",
          }}
        >
          <Feather name="x" size={18} color="#fff" />
        </Pressable>

        {/* Counter */}
        {photos.length > 1 ? (
          <Text
            style={{
              position: "absolute", top: insets.top + 18, right: 18,
              color: "rgba(255,255,255,0.9)", fontFamily: "Inter_700Bold", fontSize: 13,
            }}
          >
            {index + 1} / {photos.length}
          </Text>
        ) : null}

        {/* Credit + caption for the current photo */}
        {current ? (
          <View
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0,
              padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: "rgba(0,0,0,0.55)", gap: 4,
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              {current.uploaded_by_display_name ?? "Trust Halal"}
              {"  ·  "}
              <Text style={{ color: "#34D399" }}>
                {SOURCE_LABEL[current.source] ?? "photo"}
              </Text>
            </Text>
            {current.caption ? (
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{current.caption}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
