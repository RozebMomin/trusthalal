import { Redirect, Slot } from "expo-router";

/**
 * Dev-only screen group. The `/ui/*` routes render fixture/mockup
 * content; in production builds they must not be reachable — not even
 * via a crafted deep link (trusthalal://ui/…). Redirect out unless this
 * is a dev build.
 */
export default function UiDevLayout() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Slot />;
}
