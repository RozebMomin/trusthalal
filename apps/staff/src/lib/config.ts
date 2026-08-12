import Constants from "expo-constants";

/** API origin. Overridable via app.json `extra.apiBaseUrl` per build profile. */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)
    ?.apiBaseUrl ?? "https://api.trusthalal.org";
