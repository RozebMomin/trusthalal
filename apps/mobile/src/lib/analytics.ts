/**
 * Product analytics — a tiny, dependency-free PostHog client.
 *
 * Why not posthog-react-native? That SDK pulls in several native/Expo
 * modules (file-system, device, localization, async-storage) and needs a
 * rebuild. For explicit event tracking we only need to POST to PostHog's
 * HTTP capture API, so this stays pure-JS: it ships over-the-air, adds zero
 * native surface, and can't break a build. Autocapture / session replay /
 * offline batching are the tradeoff — we fire named events on purpose,
 * which is the taxonomy we want anyway.
 *
 * All calls are fire-and-forget and no-op when EXPO_PUBLIC_POSTHOG_KEY is
 * unset (local dev / preview), so call sites never have to guard.
 *
 * Points at the SAME PostHog project as the consumer web, so a person who
 * finds us on the web and installs the app is one funnel.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const HOST = (process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/$/, "");
const DISTINCT_ID_STORE_KEY = "ph_distinct_id_v1";

const APP_VERSION = Constants.expoConfig?.version ?? "unknown";

let cachedDistinctId: string | null = null;

/** RFC4122-ish v4 id — good enough for an anonymous distinct id. */
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getDistinctId(): Promise<string> {
  if (cachedDistinctId) return cachedDistinctId;
  let id = await SecureStore.getItemAsync(DISTINCT_ID_STORE_KEY);
  if (!id) {
    id = uuid();
    await SecureStore.setItemAsync(DISTINCT_ID_STORE_KEY, id);
  }
  cachedDistinctId = id;
  return id;
}

async function post(body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: KEY, timestamp: new Date().toISOString(), ...body }),
    });
  } catch {
    // Analytics must never surface to the user or block the UI.
  }
}

/** Fire a named event. snake_case verb_noun (e.g. "place_viewed"). */
export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!KEY) return;
  void (async () => {
    const distinct_id = await getDistinctId();
    void post({
      event,
      distinct_id,
      properties: { ...properties, platform: Platform.OS, app_version: APP_VERSION },
    });
  })();
}

/** Link the anonymous id to a signed-in user and switch future events to it. */
export function identify(userId: string, traits?: Record<string, unknown>): void {
  if (!KEY) return;
  void (async () => {
    const anon = await getDistinctId();
    void post({
      event: "$identify",
      distinct_id: userId,
      properties: { $anon_distinct_id: anon, $set: traits ?? {} },
    });
    cachedDistinctId = userId;
    await SecureStore.setItemAsync(DISTINCT_ID_STORE_KEY, userId);
  })();
}

/** On logout — stop attributing new activity to the previous user. */
export function resetAnalytics(): void {
  cachedDistinctId = null;
  void SecureStore.deleteItemAsync(DISTINCT_ID_STORE_KEY);
}
