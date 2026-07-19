import { Feather } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import {
  useCurrentUser,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from "@/lib/api/hooks";
import { registerForPush } from "@/lib/push";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Card, Seg } from "@/ui/kit";

/**
 * Notification settings — per category, per channel.
 *
 * Two layers the user has to understand, so the screen says both out loud:
 *
 *   1. The OS switch. If system permission is off, every push toggle below is
 *      moot, so that gets a banner at the top rather than letting someone flip
 *      switches that silently do nothing.
 *   2. Our per-category preferences. Push is always opt-outable. Email is
 *      opt-outable EXCEPT for transactional categories (a decision on your own
 *      claim, a dispute you filed) — those render locked with the reason, which
 *      is friendlier than a switch that snaps back when the API rejects it.
 *
 * Categories are filtered to what the signed-in user can actually receive.
 * A diner has no use for a "verifier" row, and owner claim decisions happen on
 * the web portal, so neither is shown unless it applies.
 */

type Row = {
  category: string;
  title: string;
  blurb: string;
  icon: keyof typeof Feather.glyphMap;
};

const ALL_ROWS: Row[] = [
  {
    category: "PLACE_VERIFIED",
    title: "Saved places get verified",
    blurb: "When somewhere you saved is confirmed halal by a verifier visit.",
    icon: "heart",
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

export default function NotificationSettings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const signedIn = Boolean(me);

  const prefs = useNotificationPreferences(signedIn);
  const update = useUpdateNotificationPreference();

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

  const back = (
    <Pressable
      onPress={() => router.back()}
      accessibilityLabel="Back"
      style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
    >
      <Feather name="chevron-left" size={20} color={t.sub} />
      <Text style={[ty.label, { color: t.sub, fontSize: 14 }]}>Profile</Text>
    </Pressable>
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
        {back}
        <Text style={[ty.title, { color: t.ink, marginTop: 12 }]}>
          Notifications
        </Text>
        {children}
      </ScrollView>
    </View>
  );

  if (!signedIn) {
    return shell(
      <Card style={{ padding: space.lg, gap: 10 }}>
        <Text style={[ty.body, { color: t.ink, fontWeight: "600" }]}>
          Sign in to manage notifications
        </Text>
        <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
          Notification settings are tied to your account, so they follow you
          across devices.
        </Text>
        <Button title="Sign in" onPress={() => router.push("/(auth)/sign-in")} />
      </Card>,
    );
  }

  const rows = ALL_ROWS.filter((r) => {
    if (r.category === "VERIFIER") return me?.role === "VERIFIER";
    // Claims are an owner-portal journey; only surface it if they're an owner.
    if (r.category === "CLAIM_DECISION") return me?.role === "OWNER";
    return true;
  });

  const byCategory = new Map(
    (prefs.data?.preferences ?? []).map((p) => [p.category, p]),
  );

  return shell(
    <>
      {/* --- OS permission gate ------------------------------------------ */}
      {osGranted === false && (
        <Card
          style={{
            padding: space.lg,
            gap: 10,
            borderColor: "#F59E0B",
            borderWidth: 1,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="bell-off" size={16} color="#B45309" />
            <Text style={[ty.body, { color: t.ink, fontWeight: "700" }]}>
              Push is off for Trust Halal
            </Text>
          </View>
          <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
            Your phone is blocking notifications from this app, so the push
            switches below won&rsquo;t do anything until you turn it back on in
            system settings.
          </Text>
          <Button
            title="Open settings"
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        </Card>
      )}

      {osGranted === null && !prefs.data ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : null}

      {/* Permission never asked (or dismissed) — offer it inline. */}
      {osGranted === false ? null : (
        <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
          Choose what reaches you, and how. Everything is on by default.
        </Text>
      )}

      {prefs.isError && (
        <Card style={{ padding: space.lg }}>
          <Text style={[ty.small, { color: t.sub }]}>
            Couldn&rsquo;t load your settings. Pull back and try again.
          </Text>
        </Card>
      )}

      {prefs.data && (
        <>
          {rows.map((row) => {
            const pref = byCategory.get(row.category);
            if (!pref) return null;
            // The API refuses to disable email on transactional categories;
            // mirror that here as a locked row rather than a bouncing switch.
            const emailLocked = row.category !== "PLACE_VERIFIED";

            return (
              <View key={row.category} style={{ gap: 8 }}>
                <Seg>{row.title}</Seg>
                <Card style={{ padding: space.lg, gap: 14 }}>
                  <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
                    {row.blurb}
                  </Text>

                  <ToggleRow
                    label="Push"
                    hint={
                      osGranted === false
                        ? "Blocked in system settings"
                        : undefined
                    }
                    value={pref.push}
                    disabled={update.isPending}
                    onValueChange={(next) =>
                      update.mutate({
                        category: row.category,
                        channel: "PUSH",
                        enabled: next,
                      })
                    }
                  />

                  <ToggleRow
                    label="Email"
                    hint={
                      emailLocked
                        ? "Always sent — these are receipts for your account"
                        : undefined
                    }
                    value={pref.email}
                    disabled={emailLocked || update.isPending}
                    onValueChange={(next) =>
                      update.mutate({
                        category: row.category,
                        channel: "EMAIL",
                        enabled: next,
                      })
                    }
                  />
                </Card>
              </View>
            );
          })}

          {/* Re-prompt path for someone who granted permission but has no
              token yet (e.g. reinstalled, or denied then enabled in Settings). */}
          {osGranted === true && (
            <Pressable
              onPress={() => void registerForPush()}
              style={{ paddingVertical: 10, alignItems: "center" }}
            >
              <Text style={[ty.small, { color: t.sub }]}>
                Not getting pushes? Tap to re-register this device.
              </Text>
            </Pressable>
          )}
        </>
      )}
    </>,
  );
}

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
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[
            ty.body,
            { color: disabled ? t.sub : t.ink, fontWeight: "600" },
          ]}
        >
          {label}
        </Text>
        {hint ? (
          <Text style={[ty.small, { color: t.sub, marginTop: 2 }]}>{hint}</Text>
        ) : null}
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
