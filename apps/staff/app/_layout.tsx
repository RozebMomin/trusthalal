import {
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth/auth-store";
import { usePushRouting } from "@/lib/push";
import { useTheme } from "@/lib/theme/useTheme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const t = useTheme();
  const bootstrap = useAuth((s) => s.bootstrap);
  const status = useAuth((s) => s.status);
  usePushRouting();

  const [fontsLoaded] = useFonts({
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!fontsLoaded || status === "loading") return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: t.card },
              headerTintColor: t.accent,
              headerTitleStyle: { color: t.ink, fontFamily: "Inter_700Bold" },
              headerShadowVisible: false,
              headerBackTitle: "Back",
              contentStyle: { backgroundColor: t.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="claims/index" options={{ title: "Halal claims" }} />
            <Stack.Screen name="claims/[id]" options={{ title: "Claim" }} />
            <Stack.Screen name="places/index" options={{ title: "Places" }} />
            <Stack.Screen name="places/add" options={{ title: "Add place" }} />
            <Stack.Screen name="places/bulk" options={{ title: "Bulk add" }} />
            <Stack.Screen name="verifier-applications/index" options={{ title: "Verifier applications" }} />
            <Stack.Screen name="verifier-applications/[id]" options={{ title: "Application" }} />
            <Stack.Screen name="ownership-requests/index" options={{ title: "Ownership requests" }} />
            <Stack.Screen name="ownership-requests/[id]" options={{ title: "Request" }} />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
