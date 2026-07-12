import { Feather } from "@expo/vector-icons";
import { Image, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Images render natively (zoomable); PDFs would need a webview we don't ship
 *  yet, so they show a graceful in-app placeholder instead of leaving the app. */
function isImage(url: string, contentType: string | null): boolean {
  if (contentType) return contentType.startsWith("image/");
  return /\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(url);
}

/**
 * In-app certificate viewer — a full-screen popup (no external browser).
 * The document image is pinch-zoomable via a native ScrollView, with the
 * certifying body + expiry captioned at the bottom.
 */
export function CertViewer({
  url,
  contentType,
  title,
  subtitle,
  onClose,
}: {
  url: string;
  contentType: string | null;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const image = isImage(url, contentType);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#0B0B0E" }}>
        {image ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ width, height, alignItems: "center", justifyContent: "center" }}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image source={{ uri: url }} style={{ width, height }} resizeMode="contain" />
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
            <Feather name="file-text" size={40} color="rgba(255,255,255,0.55)" />
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 16, textAlign: "center" }}>
              {title}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 19 }}>
              This certificate is a PDF. In-app PDF preview is coming soon.
            </Text>
          </View>
        )}

        <Pressable
          onPress={onClose}
          accessibilityLabel="Close certificate"
          style={{
            position: "absolute", top: insets.top + 8, left: 16, width: 36, height: 36,
            borderRadius: 999, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center",
          }}
        >
          <Feather name="x" size={18} color="#fff" />
        </Pressable>

        <View
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(0,0,0,0.55)", paddingBottom: insets.bottom + 14, paddingTop: 14, paddingHorizontal: 18,
          }}
        >
          <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>{title}</Text>
          {subtitle ? (
            <Text style={{ color: "rgba(255,255,255,0.7)", fontFamily: "Inter_500Medium", fontSize: 12.5, marginTop: 3 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
