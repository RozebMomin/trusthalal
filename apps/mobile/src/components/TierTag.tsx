import { Text, View } from "react-native";
import { toneStyle, type Tone, type PrimarySignal } from "@/lib/halal-display";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * Over a photo the tag stops theming and uses fixed dark glass with a bright
 * label — the same treatment the distance and open/closed pills on the same
 * card already use.
 *
 * ## Why it can't just use the palette here
 *
 * The "soft" tone backgrounds are opaque in light mode (``amberSoft`` is
 * ``#FEF3E2``) and 12% alpha in dark (``rgba(251,191,36,0.12)``). That's
 * correct for their normal home, a solid card, where the wash tints the card
 * beneath it. Over a photo there is no card: at 12% the food shows straight
 * through and "CERTIFIED · HMS" becomes amber text on a sandwich. The bug
 * only appeared in dark mode because light mode's washes happen to be opaque,
 * which is also why the original ``onPhoto`` branch only special-cased the
 * muted tone — the others really did look fine in the mode it was written in.
 *
 * Photos don't have a light and dark variant, so neither does this. Same
 * reasoning as the glass back/save/share buttons on the detail hero.
 */
const ON_PHOTO: Record<Tone, { fg: string; border: string }> = {
  // Bright enough to hold against a blown-out highlight, since a dark scrim
  // can't help where the photo underneath is already white.
  positive: { fg: "#6EE7B7", border: "rgba(110,231,183,0.55)" },
  trusted: { fg: "#FCD34D", border: "rgba(252,211,77,0.55)" },
  warning: { fg: "#FCA5A5", border: "rgba(252,165,165,0.55)" },
  neutral: { fg: "#E4E4E7", border: "rgba(228,228,231,0.45)" },
  muted: { fg: "#D4D4D8", border: "rgba(212,212,216,0.45)" },
};

/** The most important pixel on every screen. */
export function TierTag({
  signal,
  onPhoto = false,
}: {
  signal: PrimarySignal;
  /** Riding an image. Switches to the fixed dark-glass treatment above —
   *  set this for ANY tone over a photo, not just the transparent ones. */
  onPhoto?: boolean;
}) {
  const t = useTheme();
  const s = toneStyle(signal.tone, t);
  if (onPhoto) {
    const p = ON_PHOTO[signal.tone];
    // 0.72, not a rounder 0.6. The scrim has to carry the worst case — a
    // blown-out white photo, where it IS the background — and the labels are
    // 9.5px bold, so 4.5:1 is the bar rather than 3:1. Measured against a
    // pure-white plate under the scrim: 0.62 puts four of the five tones
    // between 3.3 and 4.3:1; 0.72 puts the weakest (warning) at 4.9:1.
    // Lower it and the amber tag goes quietly unreadable again on exactly
    // the bright food photos this is meant to survive.
    s.bg = "rgba(0,0,0,0.72)";
    s.fg = p.fg;
    s.border = p.border;
    s.dashed = false;
  }
  return (
    <View
      accessibilityLabel={signal.description}
      style={{
        alignSelf: "flex-start",
        backgroundColor: s.bg,
        borderColor: s.border,
        borderWidth: 1,
        borderStyle: s.dashed ? "dashed" : "solid",
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 3.5,
      }}
    >
      <Text
        style={{
          color: s.fg,
          fontFamily: "Inter_700Bold",
          fontSize: 9.5,
          letterSpacing: 0.3,
        }}
      >
        {signal.label}
      </Text>
    </View>
  );
}
