import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { FlatList, Image, Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
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
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;

/**
 * One pinch/pan/double-tap-zoomable image. Hand-rolled on gesture-handler +
 * reanimated (works on iOS AND Android — the old ScrollView maximumZoomScale
 * only zoomed on iOS). `panEnabled` is driven by the parent's zoom state:
 * while zoomed, the horizontal pager is disabled and one-finger pan moves the
 * image; at 1x, pan is off so swipes fall through to the pager.
 */
function ZoomableImage({
  uri,
  width,
  height,
  panEnabled,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  panEnabled: boolean;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e: { scale: number }) => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        runOnJS(onZoomChange)(true);
      }
    });

  const pan = Gesture.Pan()
    .enabled(panEnabled)
    .onUpdate((e: { translationX: number; translationY: number }) => {
      if (scale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_ZOOM);
        savedScale.value = DOUBLE_TAP_ZOOM;
        runOnJS(onZoomChange)(true);
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={[{ width, height }, style]}>
          <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/**
 * Full-screen, swipeable photo viewer with cross-platform pinch-to-zoom.
 * Chrome (counter, close, credit row, thumbnail strip) sits over a paging
 * FlatList of zoomable images. Rendered as a Modal over the place detail.
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
  const [zoomed, setZoomed] = useState(false);
  const current = photos[index];
  const many = photos.length > 1;
  const dateStr = current
    ? new Date(current.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "";

  function goTo(i: number) {
    setIndex(i);
    setZoomed(false);
    listRef.current?.scrollToIndex({ index: i, animated: true });
    stripRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A RN Modal is a separate native root on Android, so gesture-handler
          needs its own root here for pinch/pan to register. */}
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(p) => p.id}
          horizontal
          pagingEnabled
          // Disable paging while an image is zoomed so pan moves the image.
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(i);
            setZoomed(false);
            if (many) stripRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
          }}
          renderItem={({ item }) => (
            <ZoomableImage
              uri={item.url}
              width={width}
              height={height}
              panEnabled={zoomed}
              onZoomChange={setZoomed}
            />
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
