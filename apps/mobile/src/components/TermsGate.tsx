/**
 * The acknowledgement prompt for accounts that predate recorded acceptance.
 *
 * ## Why this exists
 *
 * Terms shipped after the app did. Everyone who signed up before that —
 * including the people whose reviews and photos the content licence is
 * written to cover — agreed to nothing, and the signup notice can't reach
 * them because they've already signed up. This is the only surface that can.
 *
 * ## Why it blocks
 *
 * A dismissible banner would be ignored by most people and would leave the
 * record exactly as thin as it was, which defeats the point of building it.
 * So it's modal and there is no close affordance.
 *
 * It is NOT, however, a trap. Sign out is offered, because the honest
 * alternative to accepting terms is to stop using the service, and an app
 * that locks you in a dialog with no exit is a worse thing to ship than an
 * unaccepted licence. Browsing stays possible by signing out — the gate is
 * on the account, not the app.
 *
 * ## Why it renders only when signed in
 *
 * Signed-out users have no account to attach an acceptance to, and the app
 * is usable signed out. Prompting them would be asking for a signature on
 * nobody's behalf.
 */
import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAcceptTerms, useCurrentUser, useLogout } from "@/lib/api/hooks";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/Button";

const TERMS_URL = "https://trusthalal.org/terms";
const PRIVACY_URL = "https://trusthalal.org/privacy";

export function TermsGate() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data: me } = useCurrentUser();
  const accept = useAcceptTerms();
  const logout = useLogout();
  const [failed, setFailed] = useState(false);

  const open = Boolean(me?.terms_acceptance_required);

  return (
    <Modal
      visible={open}
      animationType="slide"
      transparent={false}
      // Android hardware back must not dismiss this — that would be a close
      // affordance we deliberately didn't give it.
      onRequestClose={() => {}}
    >
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
        <ScrollView
          contentContainerStyle={{
            padding: space.lg,
            paddingBottom: insets.bottom + space.xl,
            gap: space.md,
          }}
        >
          <Text style={[ty.title, { color: t.ink, marginTop: space.lg }]}>
            A quick thing before you carry on
          </Text>

          <Text style={[ty.body, { color: t.sub, lineHeight: 22 }]}>
            We&apos;ve published terms of service. They cover what you can post,
            what happens to content that breaks the rules, and what we can and
            can&apos;t promise about a listing.
          </Text>

          <Text style={[ty.body, { color: t.sub, lineHeight: 22 }]}>
            Your account was created before we had them, so we need you to have
            a look and agree.
          </Text>

          {/* Named plainly rather than left for someone to discover in the
              document. It's the clause most likely to matter to the person
              reading this, and burying it would be the sort of thing the
              terms themselves promise we don't do. */}
          <View
            style={{
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: radii.md,
              padding: space.md,
              gap: 6,
            }}
          >
            <Text style={[ty.label, { color: t.ink, fontSize: 13 }]}>
              The short version
            </Text>
            <Text style={[ty.small, { color: t.sub, lineHeight: 19 }]}>
              There&apos;s no tolerance for objectionable content or abusive
              users. Your reviews and photos stay yours — you give us
              permission to show them, and you can delete them whenever you
              like.
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: space.lg, marginTop: 2 }}>
            <Pressable onPress={() => Linking.openURL(TERMS_URL)} accessibilityRole="link">
              <Text
                style={[
                  ty.body,
                  { color: t.accentDeep, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                Read the terms ↗
              </Text>
            </Pressable>
            <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
              <Text
                style={[
                  ty.body,
                  { color: t.accentDeep, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                Privacy ↗
              </Text>
            </Pressable>
          </View>

          {failed ? (
            <Text style={[ty.small, { color: t.danger, lineHeight: 18 }]}>
              Couldn&apos;t save that just now — check your connection and try
              again. Nothing else has changed.
            </Text>
          ) : null}

          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Button
              title="I agree"
              variant="accent"
              loading={accept.isPending}
              onPress={() => {
                setFailed(false);
                accept.mutate(undefined, { onError: () => setFailed(true) });
              }}
            />
            {/* The way out. Declining terms means not using the account, not
                being stuck in a dialog. */}
            <Pressable
              onPress={() => logout.mutate()}
              accessibilityRole="button"
              disabled={logout.isPending}
            >
              <Text
                style={[
                  ty.small,
                  { color: t.sub, textAlign: "center", paddingVertical: space.sm },
                ]}
              >
                {logout.isPending ? "Signing out…" : "Sign out instead"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
