import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
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

const THUMB = 48;
const THUMB_GAP = 8;

/**
 * Full-screen, swipeable photo viewer with pinch-to-zoom (iOS-native via a
 * zoomable ScrollView per page) and a thumbnail filmstrip. Rendered as a
 * Modal over the place detail screen; reads real `place.photos`.
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
  const stripRef = useRef<FlatList<PlacePhoto>>(null);
  const [index, setIndex] = useState(initialIndex);
  const current = photos[index];
  const many = photos.length > 1;

  function goTo(i: number) {
    setIndex(i);
    listRef.current?.scrollToIndex({ index: i, animated: true });
    stripRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
  }

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
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(i);
            if (many) stripRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
          }}
          renderItem={({ item }) => (
            // Zoomable page — iOS ScrollView gives native pinch-zoom; at min
            // zoom, horizontal swipes fall through to the pager above.
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={{ width, height }}
              maximumZoomScale={3}
              minimumZoomScale={1}
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image source={{ uri: item.url }} style={{ width, height }} resizeMode="contain" />
            </ScrollView>
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
        {many ? (
          <Text
            style={{
              position: "absolute", top: insets.top + 18, right: 18,
              color: "rgba(255,255,255,0.9)", fontFamily: "Inter_700Bold", fontSize: 13,
            }}
          >
            {index + 1} / {photos.length}
          </Text>
        ) : null}

        {/* Bottom: thumbnail strip + credit */}
        <View
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0,0,0,0.55)", paddingBottom: insets.bottom + 12,
          }}
        >
          {many ? (
            <FlatList
              ref={stripRef}
              data={photos}
              keyExtractor={(p) => `t-${p.id}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={initialIndex}
              getItemLayout={(_, i) => ({ length: THUMB + THUMB_GAP, offset: (THUMB + THUMB_GAP) * i, index: i })}
              contentContainerStyle={{ paddingHorizontal: 16, gap: THUMB_GAP, paddingVertical: 10 }}
              renderItem={({ item, index: i }) => (
                <Pressable onPress={() => goTo(i)} accessibilityLabel={`Photo ${i + 1}`}>
                  <Image
                    source={{ uri: item.url }}
                    style={{
                      width: THUMB, height: THUMB, borderRadius: 8,
                      borderWidth: i === index ? 2 : 0, borderColor: "#34D399",
                      opacity: i === index ? 1 : 0.55,
                    }}
                  />
                </Pressable>
              )}
            />
          ) : null}
          {current ? (
            <View style={{ paddingHorizontal: 16, paddingTop: many ? 0 : 4, gap: 4 }}>
              <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                {current.uploaded_by_display_name ?? "Trust Halal"}
                {"  ·  "}
                <Text style={{ color: "#34D399" }}>{SOURCE_LABEL[current.source] ?? "photo"}</Text>
              </Text>
              {current.caption ? (
                <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{current.caption}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
