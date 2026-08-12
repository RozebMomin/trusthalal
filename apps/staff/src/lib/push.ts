/**
 * Push notifications for the staff console: permission, token registration,
 * and tap routing.
 *
 * Flow: once signed in, ask permission, fetch the Expo push token, POST it to
 * `/me/devices`. On sign-out, DELETE it. Notifications carry an app-relative
 * `data.path` (e.g. `/claims/<id>`) and tapping routes straight there. Every
 * step degrades quietly: simulators can't issue tokens, a denied permission
 * is a normal outcome, and a failed register must never block sign-in.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { apiFetch } from "./api/client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let currentToken: string | null = null;

function projectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/** Ask for permission (if undecided) and register this device. Returns the
 *  token, or null when push isn't available/allowed. */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Trust Halal Staff",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
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
    // Best effort; the server prunes dead tokens on send.
  } finally {
    currentToken = null;
  }
}

function routeTo(response: Notifications.NotificationResponse): void {
  const data = response.notification.request.content.data ?? {};
  const path = data.path;
  // Only follow app-relative paths, never anything that looks like a URL.
  if (
    typeof path === "string" &&
    path.startsWith("/") &&
    !path.startsWith("//")
  ) {
    router.push(path as never);
  }
}

/** Wire notification taps to routing. Mount once near the root. */
export function usePushRouting(): void {
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) routeTo(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(routeTo);
    return () => sub.remove();
  }, []);
}
