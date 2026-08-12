import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Card, H1, Muted, Pill, Screen } from "@/components/ui";
import { useHalalClaims } from "@/lib/api/hooks";
import { useAuth } from "@/lib/auth/auth-store";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";

/** All admin queues. `href` present = wired; absent = coming in a later pass. */
const SECTIONS: {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  href?: string;
}[] = [
  { key: "claims", label: "Halal claims", icon: "check-circle", href: "/claims" },
  { key: "disputes", label: "Disputes", icon: "alert-octagon" },
  { key: "visits", label: "Verification visits", icon: "map-pin" },
  { key: "reviews", label: "Reported reviews", icon: "flag" },
  { key: "photos", label: "Reported photos", icon: "image" },
  { key: "verifiers", label: "Verifier applications", icon: "user-check" },
  { key: "ownership", label: "Ownership requests", icon: "briefcase" },
  { key: "users", label: "Users", icon: "users" },
  { key: "suppliers", label: "Suppliers", icon: "truck" },
  { key: "orgs", label: "Organizations", icon: "home" },
  { key: "places", label: "Places", icon: "map" },
];

export default function Dashboard() {
  const t = useTheme();
  const router = useRouter();
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const claims = useHalalClaims("PENDING_REVIEW");

  if (status !== "authed") return <Redirect href="/login" />;

  const pendingClaims = claims.data?.length;

  return (
    <Screen>
      <View style={{ marginBottom: space.sm }}>
        <H1>Queues</H1>
        <Muted>Signed in as {user?.email}</Muted>
      </View>

      <View style={{ gap: space.sm }}>
        {SECTIONS.map((s) => {
          const wired = Boolean(s.href);
          const count = s.key === "claims" ? pendingClaims : undefined;
          return (
            <Pressable
              key={s.key}
              disabled={!wired}
              onPress={() => s.href && router.push(s.href as never)}
              style={{
                opacity: wired ? 1 : 0.55,
                backgroundColor: t.card,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: t.line,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
              }}
            >
              <Feather name={s.icon} size={18} color={t.accent} />
              <Text style={[ty.label, { color: t.ink, flex: 1 }]}>{s.label}</Text>
              {count !== undefined && count > 0 ? (
                <Pill label={String(count)} tone="amber" />
              ) : null}
              {wired ? (
                <Feather name="chevron-right" size={18} color={t.sub} />
              ) : (
                <Pill label="Soon" tone="neutral" />
              )}
            </Pressable>
          );
        })}
      </View>

      <Card style={{ marginTop: space.lg }}>
        <Pressable
          onPress={() => void logout()}
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Feather name="log-out" size={16} color={t.danger} />
          <Text style={[ty.label, { color: t.danger }]}>Sign out</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}
