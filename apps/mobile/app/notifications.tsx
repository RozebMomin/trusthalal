import { Feather } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import {
  NotificationCategoryDetail,
  type NotifRow,
} from "@/components/NotificationCategoryDetail";
import {
  useCurrentUser,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from "@/lib/api/hooks";
import { registerForPush } from "@/lib/push";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, ScreenHeader, Seg } from "@/ui/kit";

/**
 * Notification settings — a hub of categories, each opening a detail with the
 * delivery controls we can actually honour today (push + email per category).
 *
 * Two layers the user has to understand, surfaced explicitly:
 *   1. The OS switch. If system permission is off, every push toggle is moot,
 *      so a banner leads rather than letting someone flip dead switches.
 *   2. Our per-category preferences. Push is always opt-outable. Email is
 *      opt-outable EXCEPT for transactional categories (a decision on your own
 *      claim, a dispute you filed) — those render locked with the reason.
 *
 * Deliberately NOT here yet (backend can't cash it): per-event granularity
 * inside a category, email digests/frequency, and a marketing "Product updates"
 * stream. The IA leaves room to add per-event toggles to a detail later.
 */

const ALL_ROWS: NotifRow[] = [
  {
    category: "PLACE_VERIFIED",
    title: "Saved places",
    blurb: "When somewhere you saved is confirmed halal by a verifier visit.",
    icon: "star",
  },
  {
    category: "DISPUTE",
    title: "Your reports",
    blurb: "Updates when Trust Halal reviews an issue you reported.",
    icon: "flag",
  },
  {
    category: "VERIFIER",
    title: "Verifier activity",
    blurb: "Decisions on your visits and changes to your verifier access.",
    icon: "shield",
  },
  {
    category: "CLAIM_DECISION",
    title: "Restaurant claims",
    blurb: "Decisions on businesses and restaurants you've claimed.",
    icon: "briefcase",
  },
];

function statusFor(push: boolean, email: boolean): { label: string; on: boolean } {
  if (push && email) return { label: "On", on: true };
  if (!push && !email) return { label: "Off", on: false };
  return { label: push ? "Push only" : "Email only", on: true };
}

export default function NotificationSettings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const signedIn = Boolean(me);

  const prefs = useNotificationPreferences(signedIn);
  const update = useUpdateNotificationPreference();

  const [openRow, setOpenRow] = useState<NotifRow | null>(null);

  // OS-level permission. Re-checked on focus so returning from Settings
  // reflects reality instead of a stale read from mount time.
  const [osGranted, setOsGranted] = useState<boolean | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void Notifications.getPermissionsAsync().then((p) => {
        if (alive) setOsGranted(p.granted);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const shell = (children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          padding: space.lg,
          paddingBottom: 60,
          gap: space.md,
        }}
      >
        <ScreenHeader title="Notifications" onBack={() => router.back()} />
        {children}
      </ScrollView>
    </View>
  );

  if (!signedIn) {
    return shell(
      <Card style={{ padding: space.lg, gap: 10 }}>
        <Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>Sign in to manage notifications</Text>
        <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
          Notification settings are tied to your account, so they follow you across devices.
        </Text>
        <Button title="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
      </Card>,
    );
  }

  const rows = ALL_ROWS.filter((r) => {
    if (r.category === "VERIFIER") return me?.role === "VERIFIER";
    if (r.category === "CLAIM_DECISION") return me?.role === "OWNER";
    return true;
  });

  const byCategory = new Map((prefs.data?.preferences ?? []).map((p) => [p.category, p]));

  return (
    <>
      {shell(
        <>
          <Text style={[ty.small, { color: t.sub, lineHeight: 20, fontSize: 14 }]}>
            Stay informed about what matters to you on Trust Halal.
          </Text>

          {/* OS permission gate */}
          {osGranted === false && (
            <Card style={{ padding: 16, gap: 10, backgroundColor: t.amberSoft }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <Feather name="bell-off" size={18} color={t.amber} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[ty.body, { color: t.ink, fontFamily: "Inter_700Bold", fontSize: 15 }]}>
                    Push notifications are off
                  </Text>
                  <Text style={[ty.small, { color: t.sub, lineHeight: 19, marginTop: 3 }]}>
                    Enable them in your phone&rsquo;s Settings to receive push alerts.
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => void Linking.openSettings()}
                style={{ alignItems: "center", backgroundColor: t.card, borderRadius: 12, paddingVertical: 12 }}
              >
                <Text style={{ color: t.accentDeep, fontFamily: "Inter_700Bold", fontSize: 14 }}>Open Settings</Text>
              </Pressable>
            </Card>
          )}

          {osGranted === null && !prefs.data ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator color={t.accent} />
            </View>
          ) : null}

          {prefs.isError && (
            <Card style={{ padding: space.lg }}>
              <Text style={[ty.small, { color: t.sub }]}>Couldn&rsquo;t load your settings. Pull back and try again.</Text>
            </Card>
          )}

          {prefs.data && (
            <>
              <Seg>Your notifications</Seg>
              <View style={{ gap: space.md }}>
                {rows.map((row) => {
                  const pref = byCategory.get(row.category);
                  if (!pref) return null;
                  const status = statusFor(pref.push, pref.email);
                  return (
                    <Pressable key={row.category} onPress={() => setOpenRow(row)}>
                      <Card style={{ padding: 16 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                          <View
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 23,
                              backgroundColor: t.accentSoft,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Feather name={row.icon} size={22} color={t.accentDeep} />
                          </View>
                          <View style={{ flex: 1, gap: 3 }}>
                            <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 16 }}>{row.title}</Text>
                            <Text style={[ty.small, { color: t.sub, fontSize: 13, lineHeight: 18 }]}>{row.blurb}</Text>
                          </View>
                          <View style={{ alignItems: "flex-end", gap: 6 }}>
                            <View
                              style={{
                                backgroundColor: status.on ? t.accentSoft : t.zincSoft,
                                borderRadius: 999,
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                              }}
                            >
                              <Text
                                style={{
                                  color: status.on ? t.accentDeep : t.sub,
                                  fontFamily: "Inter_700Bold",
                                  fontSize: 11.5,
                                }}
                              >
                                {status.label}
                              </Text>
                            </View>
                            <Feather name="chevron-right" size={20} color={t.sub} />
                          </View>
                        </View>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>

              {/* Help / re-register — context-aware */}
              <Pressable
                onPress={() => (osGranted === false ? void Linking.openSettings() : void registerForPush())}
                style={{ marginTop: 4 }}
              >
                <Card style={{ padding: 16, backgroundColor: t.zincSoft }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Feather name="help-circle" size={20} color={t.sub} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.ink, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                        Why am I not getting push notifications?
                      </Text>
                      <Text style={[ty.small, { color: t.sub, fontSize: 12.5, marginTop: 2 }]}>
                        {osGranted === false
                          ? "Push is off in system settings. Tap to open them."
                          : "Tap to re-register this device for push."}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={t.sub} />
                  </View>
                </Card>
              </Pressable>
            </>
          )}
        </>,
      )}

      <NotificationCategoryDetail
        row={openRow}
        push={openRow ? (byCategory.get(openRow.category)?.push ?? false) : false}
        email={openRow ? (byCategory.get(openRow.category)?.email ?? false) : false}
        emailLocked={openRow ? openRow.category !== "PLACE_VERIFIED" : false}
        osBlocked={osGranted === false}
        pending={update.isPending}
        onToggle={(channel, enabled) =>
          openRow && update.mutate({ category: openRow.category, channel, enabled })
        }
        onClose={() => setOpenRow(null)}
      />
    </>
  );
}
