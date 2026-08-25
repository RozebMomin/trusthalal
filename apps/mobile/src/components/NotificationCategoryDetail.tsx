import { Feather } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Easing, Linking, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

export type NotifRow = {
  category: string;
  title: string;
  blurb: string;
  icon: keyof typeof Feather.glyphMap;
};

function ToggleRow({
  label,
  hint,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 4 }}>
      <View style={{ flex: 1 }}>
        <Text style={[ty.body, { color: disabled ? t.sub : t.ink, fontFamily: "Inter_600SemiBold", fontSize: 16 }]}>
          {label}
        </Text>
        {hint ? <Text style={[ty.small, { color: t.sub, marginTop: 2, lineHeight: 17 }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: t.accent, false: t.line }}
        accessibilityLabel={label}
      />
    </View>
  );
}

/**
 * The per-category notification detail — the delivery controls we can actually
 * honour today: push + email for this category. (Per-event granularity and
 * digests are deliberately out; see the Notifications hub note.) Opens as a
 * full-screen sheet over the hub.
 */
export function NotificationCategoryDetail({
  row,
  push,
  email,
  emailLocked,
  osBlocked,
  pending,
  onToggle,
  onClose,
}: {
  row: NotifRow | null;
  push: boolean;
  email: boolean;
  /** Email can't be silenced on transactional categories (receipts). */
  emailLocked: boolean;
  /** OS push permission is off, so push here won't deliver until re-enabled. */
  osBlocked: boolean;
  pending: boolean;
  onToggle: (channel: "PUSH" | "EMAIL", enabled: boolean) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const tx = useRef(new Animated.Value(60)).current;
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (row) {
      tx.setValue(60);
      op.setValue(0);
      Animated.parallel([
        Animated.timing(tx, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    }
  }, [row, tx, op]);

  if (!row) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: t.bg, opacity: op, transform: [{ translateX: tx }] }}>
        <View style={{ flex: 1, paddingTop: insets.top + space.md }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: insets.bottom + 24, gap: 12 }}>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
            >
              <Feather name="chevron-left" size={20} color={t.accentDeep} />
              <Text style={[ty.label, { color: t.accentDeep, fontSize: 15 }]}>Back</Text>
            </Pressable>

            {/* Centered hero: icon + title + blurb */}
            <View style={{ alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: t.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name={row.icon} size={28} color={t.accentDeep} />
              </View>
              <Text style={[ty.title, { color: t.ink, fontSize: 24, textAlign: "center" }]}>{row.title}</Text>
              <Text style={[ty.small, { color: t.sub, fontSize: 14, lineHeight: 20, textAlign: "center", paddingHorizontal: 10 }]}>
                {row.blurb}
              </Text>
            </View>

            {osBlocked ? (
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  backgroundColor: t.amberSoft,
                  borderRadius: radii.xl,
                  padding: 14,
                  alignItems: "flex-start",
                }}
              >
                <Feather name="bell-off" size={18} color={t.amber} style={{ marginTop: 1 }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={[ty.small, { color: t.ink, fontFamily: "Inter_700Bold", fontSize: 13 }]}>
                    Push is off in system settings
                  </Text>
                  <Pressable
                    onPress={() => void Linking.openSettings()}
                    style={{ alignSelf: "flex-start", backgroundColor: t.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 }}
                  >
                    <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 13 }}>Open Settings</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <Text style={[ty.seg, { color: t.sub, marginTop: 6, marginLeft: 2 }]}>Delivery methods</Text>
            <View style={{ backgroundColor: t.card, borderRadius: radii.xl, paddingHorizontal: 18, paddingVertical: 8, gap: 4 }}>
              <ToggleRow
                label="Push notifications"
                hint={osBlocked ? "Blocked in system settings" : "Instant alerts on your phone."}
                value={push}
                disabled={pending}
                onValueChange={(v) => onToggle("PUSH", v)}
              />
              <View style={{ height: 1, backgroundColor: t.line }} />
              <ToggleRow
                label="Email"
                hint={emailLocked ? "Always sent — these are receipts for your account." : "Updates in your inbox."}
                value={email}
                disabled={emailLocked || pending}
                onValueChange={(v) => onToggle("EMAIL", v)}
              />
            </View>

            <Text style={[ty.small, { color: t.sub, fontSize: 12.5, lineHeight: 18, marginTop: 4, marginLeft: 2 }]}>
              Changes save automatically and apply to this category everywhere you use Trust Halal.
            </Text>
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}
