/**
 * Report a review, or the owner's reply to it.
 *
 * This existing at all is the point. Reviews publish immediately and the
 * content filter only catches *language* — whether a factual claim about a
 * restaurant is false is a question about the world, not about the words, so
 * the report queue is the only defence against the claims that actually
 * damage a business. Until this shipped, a diner on mobile could read a
 * review accusing a restaurant of serving pork and had no way to flag it.
 *
 * Mirrors the web dialog's reasons and copy deliberately: someone who reports
 * something on the phone and then on the laptop should not be asked two
 * different questions about the same review.
 */
import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useReportReview } from "@/lib/api/hooks";
import type { PlaceReviewRead, ReviewReportReason } from "@/lib/api/types";
import { radii, space, type as ty } from "@/lib/theme";
import { useTheme } from "@/lib/theme/useTheme";
import { Sheet } from "@/ui/kit";

const DETAIL_MAX = 2000;

const REASONS: Array<{
  value: ReviewReportReason;
  label: string;
  hint: string;
}> = [
  {
    value: "FALSE_INFO",
    label: "It states something false",
    hint: "Presents a claim as fact that isn't true.",
  },
  {
    value: "HARASSMENT",
    label: "Harassment or abuse",
    hint: "Targets a person rather than the experience.",
  },
  {
    value: "OFF_TOPIC",
    label: "Not about this restaurant",
    hint: "Wrong business, or nothing to do with the visit.",
  },
  {
    value: "SPAM",
    label: "Spam",
    hint: "Advertising, links, or repeated posting.",
  },
  {
    value: "CONFLICT_OF_INTEREST",
    label: "Conflict of interest",
    hint: "Written by a competitor, or someone connected to the business.",
  },
  {
    value: "OTHER",
    label: "Something else",
    hint: "Tell us what's wrong and we'll look.",
  },
];

export function ReportReviewSheet({
  placeId,
  review,
  visible,
  onClose,
}: {
  placeId: string;
  review: PlaceReviewRead;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const report = useReportReview(placeId);

  const [target, setTarget] = useState<"review" | "reply">("review");
  const [reason, setReason] = useState<ReviewReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Reset on open, not on close: leaving the old selection visible during the
  // dismiss animation looks like the sheet forgot what you picked.
  useEffect(() => {
    if (visible) {
      setTarget("review");
      setReason(null);
      setDetail("");
      setErrorMsg(null);
      setDone(false);
    }
  }, [visible]);

  // "Something else" with no explanation is unactionable — the moderator has
  // literally nothing to weigh. Server enforces the same rule; this just
  // avoids a round trip to be told so.
  const detailRequired = reason === "OTHER";
  const canSubmit =
    reason !== null &&
    (!detailRequired || detail.trim().length > 0) &&
    !report.isPending;

  async function submit() {
    if (!canSubmit || reason === null) return;
    setErrorMsg(null);
    try {
      await report.mutateAsync({
        reviewId: review.id,
        reason,
        detail: detail.trim() || undefined,
        replyId: target === "reply" && review.reply ? review.reply.id : undefined,
      });
      setDone(true);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setErrorMsg(
        status === 409
          ? "You've already reported this. We'll take a look."
          : status === 401
            ? "Sign in to report something."
            : status === 503
              ? "We couldn't run our content check just now — that's on us. Try again in a moment."
              : "Couldn't send that report. Try again in a moment.",
      );
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {done ? (
          <View style={{ alignItems: "center", paddingVertical: space.lg }}>
            <Feather name="check-circle" size={30} color={t.accentDeep} />
            <Text style={[ty.h2, { color: t.ink, marginTop: 10, fontSize: 17 }]}>
              Thanks — we'll take a look
            </Text>
            {/* Honest about what a report is and isn't. Implying it's a delete
                button produces a second angry message when nothing happens. */}
            <Text
              style={[
                ty.small,
                { color: t.sub, marginTop: 6, textAlign: "center", lineHeight: 18 },
              ]}
            >
              A person reviews every report. Content stays up unless it breaks
              our guidelines, so you may not see an immediate change.
            </Text>
            <Pressable
              onPress={onClose}
              style={{
                marginTop: space.lg,
                backgroundColor: t.ink,
                borderRadius: radii.md,
                paddingVertical: 11,
                paddingHorizontal: 26,
              }}
            >
              <Text style={{ color: t.onInk, fontFamily: "Inter_700Bold", fontSize: 13.5 }}>
                Done
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[ty.h2, { color: t.ink, fontSize: 18 }]}>
              Report this
            </Text>
            <Text style={[ty.small, { color: t.sub, marginTop: 4, lineHeight: 18 }]}>
              Tell us what's wrong and a person will read it. Reporting isn't
              the same as removing — we only take content down when it breaks
              our guidelines.
            </Text>

            {/* Only offered when there IS a reply. An owner's reply carries
                the platform's implicit endorsement, so it needs to be
                reportable in its own right rather than folded into the
                review it answers. */}
            {review.reply ? (
              <View style={{ flexDirection: "row", gap: 6, marginTop: space.md }}>
                {(
                  [
                    ["review", "The review"],
                    ["reply", "The owner's reply"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setTarget(value)}
                    style={{
                      flex: 1,
                      borderRadius: radii.md,
                      borderWidth: 1,
                      borderColor: target === value ? t.ink : t.line,
                      backgroundColor: target === value ? t.ink : t.card,
                      paddingVertical: 9,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 12.5,
                        color: target === value ? t.onInk : t.sub,
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={{ marginTop: space.md, gap: 7 }}>
              {REASONS.map((r) => {
                const active = reason === r.value;
                return (
                  <Pressable
                    key={r.value}
                    onPress={() => setReason(r.value)}
                    style={{
                      borderRadius: radii.md,
                      borderWidth: 1,
                      borderColor: active ? t.accentDeep : t.line,
                      backgroundColor: active ? t.accentSoft : t.card,
                      padding: 11,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 13.5,
                        color: active ? t.accentDeep : t.ink,
                      }}
                    >
                      {r.label}
                    </Text>
                    <Text style={[ty.small, { color: t.sub, marginTop: 2, fontSize: 11.5 }]}>
                      {r.hint}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[ty.label, { color: t.ink, marginTop: space.md, fontSize: 12.5 }]}>
              {detailRequired ? "What's wrong?" : "Anything else? (optional)"}
            </Text>
            <TextInput
              value={detail}
              onChangeText={setDetail}
              multiline
              maxLength={DETAIL_MAX}
              placeholder="What should we know?"
              placeholderTextColor={t.sub}
              style={{
                marginTop: 6,
                minHeight: 84,
                borderWidth: 1,
                borderColor: t.line,
                borderRadius: radii.md,
                backgroundColor: t.card,
                padding: 11,
                color: t.ink,
                fontFamily: "Inter_400Regular",
                fontSize: 13.5,
                textAlignVertical: "top",
              }}
            />

            {errorMsg ? (
              <Text style={[ty.small, { color: "#B91C1C", marginTop: 8 }]}>
                {errorMsg}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", gap: 8, marginTop: space.lg }}>
              <Pressable
                onPress={onClose}
                style={{
                  flex: 1,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: t.line,
                  paddingVertical: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: t.sub, fontFamily: "Inter_600SemiBold", fontSize: 13.5 }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                style={{
                  flex: 2,
                  borderRadius: radii.md,
                  backgroundColor: canSubmit ? t.ink : t.zincSoft,
                  paddingVertical: 12,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: canSubmit ? t.onInk : t.sub,
                    fontFamily: "Inter_700Bold",
                    fontSize: 13.5,
                  }}
                >
                  {report.isPending ? "Sending…" : "Send report"}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}
