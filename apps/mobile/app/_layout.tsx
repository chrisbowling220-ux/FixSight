import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ScanFlowProvider } from "../src/state/ScanFlowContext";
import { colors } from "../src/theme";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 15_000 },
      mutations: { retry: 0 },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ScanFlowProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.canvas },
            headerShadowVisible: false,
            headerTintColor: colors.ink,
            contentStyle: { backgroundColor: colors.canvas },
            headerBackTitle: "Back",
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="analyzing" options={{ title: "Analyzing", headerBackVisible: false }} />
          <Stack.Screen name="follow-up" options={{ title: "A few details" }} />
          <Stack.Screen name="result" options={{ title: "FixSight result", headerBackVisible: false }} />
          <Stack.Screen name="history/[id]" options={{ title: "Saved scan" }} />
        </Stack>
      </ScanFlowProvider>
    </QueryClientProvider>
  );
}
