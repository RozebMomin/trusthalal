import {
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import { router, Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { TermsGate } from "@/components/TermsGate";
import { StatusBar } from "expo-status-bar";
import { useCurrentUser } from "@/lib/api/hooks";
import { usePushNotifications } from "@/lib/push";
import { dark, light } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();

// Crash/error reporting. No-op without a DSN, and disabled in local dev so we
// don't flood the project while iterating. The DSN is a public value (safe to
// embed). Source-map upload for readable stack traces needs org/project + a
// SENTRY_AUTH_TOKEN at EAS build time — configured later.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: !__DEV__,
    tracesSampleRate: 0.2,
  });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * Registers the device for push once someone is signed in, and routes
 * notification taps. Lives inside QueryClientProvider because it reads the
 * session; renders nothing.
 */
function PushBridge() {
  const { data: me } = useCurrentUser();
  usePushNotifications(Boolean(me));
  return null;
}

function RootLayout() {
  const scheme = useColorScheme();
  const t = scheme === "dark" ? dark : light;
  const [loaded] = useFonts({
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (!loaded) return;
    SplashScreen.hideAsync();
    // First run → onboarding (mockups 9–11). Flag lives in SecureStore.
    SecureStore.getItemAsync("onboarded_v1").then((seen) => {
      if (!seen) router.replace("/onboarding");
    });
  }, [loaded]);
  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <PushBridge />
        {/* Renders nothing unless the signed-in account owes an
            acknowledgement. Sits beside PushBridge, inside the query
            provider, so it sees the same /me every screen sees — and above
            the Stack so it covers whatever screen someone happens to be on
            when they open the app. */}
        <TermsGate />
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ presentation: "modal" }} />
          <Stack.Screen name="(auth)/sign-up" options={{ presentation: "modal" }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap enables navigation/perf instrumentation + error boundaries.
export default Sentry.wrap(RootLayout);
