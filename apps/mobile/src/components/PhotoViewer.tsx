import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { FlatList, Image, Modal, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Gallery, { type GalleryRef } from "react-native-awesome-gallery";
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
 * Full-screen photo viewer. The image area is `react-native-awesome-gallery`
 * (gesture-handler + reanimated), so pinch-to-zoom, double-tap zoom, pan, and
 * swipe-between work on BOTH iOS and Android — the old iOS-only ScrollView
 * `maximumZoomScale` never zoomed on Android. Our chrome (counter, close,
 * credit row, thumbnail strip) is layered on top as overlays. Swipe down
 * dismisses. Rendered as a Modal over the place detail screen.
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
  const insets = useSafeAreaInsets();
  const stripRef = useRef<FlatList<PlacePhoto>>(null);
  const galleryRef = useRef<GalleryRef>(null);
  const [index, setIndex] = useState(initialIndex);
  const current = photos[index];
  const many = photos.length > 1;
  const dateStr = current
    ? new Date(current.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "";

  const uris = photos.map((p) => p.url);

  function goTo(i: number) {
    galleryRef.current?.setIndex(i, true);
    setIndex(i);
    stripRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A RN Modal is a separate native root on Android, so gesture-handler
          needs its own root here for the gallery's pinch/pan to register. */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
        <Gallery
          ref={galleryRef}
          data={uris}
          initialIndex={initialIndex}
          onIndexChange={(i: number) => {
            setIndex(i);
            if (many) stripRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
          }}
          onSwipeToClose={onClose}
          doubleTapScale={3}
          maxScale={6}
          style={{ flex: 1 }}
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

        {/* Bottom: credit (avatar + name/role + caption/date), then the
            thumbnail strip below it — matches mockup 30. */}
        <View
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0,0,0,0.55)", paddingBottom: insets.bottom + 12,
          }}
        >
          {current ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 16, paddingTop: 14 }}>
              <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: "#059669", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 12 }}>
                  {(current.uploaded_by_display_name ?? "T").trim().charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  {current.uploaded_by_display_name ?? "Trust Halal"}
                  {"  ·  "}
                  <Text style={{ color: "#34D399" }}>{SOURCE_LABEL[current.source] ?? "photo"}</Text>
                </Text>
                <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.6)", fontSize: 11.5, marginTop: 1 }}>
                  {current.caption ? `“${current.caption}” · ` : ""}{dateStr}
                </Text>
              </View>
            </View>
          ) : null}
          {many ? (
            <FlatList
              ref={stripRef}
              data={photos}
              keyExtractor={(p) => `t-${p.id}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={initialIndex}
              getItemLayout={(_, i) => ({ length: THUMB + THUMB_GAP, offset: (THUMB + THUMB_GAP) * i, index: i })}
              contentContainerStyle={{ paddingHorizontal: 16, gap: THUMB_GAP, paddingTop: 12, paddingBottom: 2 }}
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
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
