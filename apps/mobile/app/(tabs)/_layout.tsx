import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { colors } from "../../src/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.line, backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen
        name="capture"
        options={{
          title: "New scan",
          tabBarLabel: "Scan",
          tabBarIcon: ({ focused, size }) => <Ionicons name="scan" color={focused ? colors.brand : colors.muted} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Scan history",
          tabBarLabel: "History",
          tabBarIcon: ({ focused, size }) => <Ionicons name="time-outline" color={focused ? colors.brand : colors.muted} size={size} />,
        }}
      />
    </Tabs>
  );
}
