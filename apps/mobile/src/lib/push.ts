/**
 * Push notifications — permission, token registration, and tap routing.
 *
 * Flow:
 *   1. Once a user is signed in, ask for permission (never on cold start —
 *      a permission prompt before the app has shown any value is the fastest
 *      way to a permanent "Don't Allow").
 *   2. Fetch the Expo push token and POST it to `/me/devices`.
 *   3. On sign-out, DELETE it so the next person on that phone doesn't get
 *      the previous account's pushes.
 *
 * Deep links: the API sends `data.path` (e.g. `/places/<id>`, `/visit/<id>`,
 * `/verify`). Tapping a notification routes straight there. We deliberately
 * send a relative router path rather than a URL so the app never has to parse
 * or trust an inbound origin.
 *
 * Everything here degrades quietly. Simulators can't issue push tokens, a
 * denied permission is a normal outcome, and a failed register call must
 * never block sign-in.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { apiFetch } from "./api/client";

/** Show a banner even when the app is foregrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Last token we registered, so sign-out can unregister precisely. */
let currentToken: string | null = null;

function projectId(): string | undefined {
  // EAS injects this at build time; both spellings appear across SDK versions.
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * Ask for permission (if not already decided) and register this device.
 * Returns the token, or null when push isn't available/allowed — callers
 * treat null as "fine, carry on".
 */
export async function registerForPush(): Promise<string | null> {
  // Push tokens require real hardware; simulators always fail.
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    // Must exist before the first notification arrives, and the id has to
    // match the `channelId` the API sends.
    await Notifications.setNotificationChannelAsync("default", {
      name: "Trust Halal",
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const asked = await Notifications.requestPermissionsAsync();
    granted = asked.granted;
  }
  if (!granted) return null;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: projectId(),
    });
    await apiFetch("/me/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    currentToken = token;
    return token;
  } catch {
    // No project id, offline, Expo push service down — none of which should
    // surface to the user.
    return null;
  }
}

/** Drop this device's registration. Safe to call when never registered. */
export async function unregisterPush(): Promise<void> {
  if (!currentToken) return;
  try {
    await apiFetch(`/me/devices/${encodeURIComponent(currentToken)}`, {
      method: "DELETE",
    });
  } catch {
    // Best effort — the server prunes dead tokens on send anyway.
  } finally {
    currentToken = null;
  }
}

function routeTo(response: Notifications.NotificationResponse): void {
  const path = response.notification.request.content.data?.path;
  // Only follow app-relative paths — never anything that looks like a URL.
  if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) {
    router.push(path as never);
  }
}

/**
 * Registers the device once the user is signed in, and wires notification
 * taps to routing. Mount once, near the root.
 *
 * `isSignedIn` drives registration rather than a mount-time call so we only
 * prompt someone who has an account for pushes to belong to.
 */
export function usePushNotifications(isSignedIn: boolean): void {
  const registered = useRef(false);

  useEffect(() => {
    if (!isSignedIn) {
      registered.current = false;
      return;
    }
    if (registered.current) return;
    registered.current = true;
    void registerForPush();
  }, [isSignedIn]);

  useEffect(() => {
    // Cold start: the app was launched by tapping a notification.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) routeTo(response);
    });
    // Warm: tapped while the app was already running/backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener(routeTo);
    return () => sub.remove();
  }, []);
}
