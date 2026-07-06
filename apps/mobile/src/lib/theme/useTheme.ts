import { useColorScheme } from "react-native";
import { dark, light, type Palette } from "./index";

/** Dark mode ships at launch — same components, token-swapped. */
export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
