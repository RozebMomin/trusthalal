/**
 * The Trust Halal mark, drawn from the same file the installed app icon uses.
 *
 * ## Why an Image and not a hand-drawn View
 *
 * Onboarding and sign-in each drew their own mark: an accent-coloured rounded
 * square with a Feather "check" in it. That was the old logo. When the mark
 * became the eight-point star, the icon assets were regenerated and these two
 * screens were not — so the first thing a new user saw after tapping a star
 * on their home screen was a green tick, and nothing in the app matched the
 * thing they had just installed.
 *
 * Pointing at assets/icon.png means that can't drift again. Rerunning
 * brand-assets/generate_icons.py updates the app icon and these screens in
 * the same pass, which is the whole reason that script exists.
 *
 * ## The corner radius
 *
 * icon.png is the SQUARE variant, deliberately — iOS applies its own
 * superellipse mask to the home-screen icon, so shipping a pre-rounded file
 * would round it twice. Nothing masks it here, so the radius is applied at
 * render. 0.225 matches the RX=230/1024 the generator uses for the rounded
 * variants, so an in-app mark and a home-screen icon read as the same shape.
 */
import { Image } from "react-native";

/** Matches RX / CANVAS in brand-assets/generate_icons.py (230 / 1024). */
const CORNER_RATIO = 0.225;

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require("../../assets/icon.png")}
      style={{
        width: size,
        height: size,
        borderRadius: size * CORNER_RATIO,
      }}
      // The mark is decorative wherever it appears — every screen using it
      // has a headline directly beneath saying the same thing in words, and
      // announcing "Trust Halal logo" before "Welcome back" is noise.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
