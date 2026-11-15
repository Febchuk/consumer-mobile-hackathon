import { Stack } from "expo-router";
import { ConvexProvider } from "convex/react";
import { useFonts } from "expo-font";
import { Fraunces_600SemiBold, Fraunces_800ExtraBold } from "@expo-google-fonts/fraunces";
import {
  InstrumentSans_400Regular,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from "@expo-google-fonts/instrument-sans";
import { JetBrainsMono_500Medium, JetBrainsMono_800ExtraBold } from "@expo-google-fonts/jetbrains-mono";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { convex } from "@/lib/convex";
import { IdentityProvider } from "@/lib/identity";
import { C } from "@/lib/theme";

export default function RootLayout() {
  const [loaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_800ExtraBold,
    InstrumentSans_400Regular,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_800ExtraBold,
  });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: C.paper }} />;
  return (
    <ConvexProvider client={convex}>
      <IdentityProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.paper } }} />
      </IdentityProvider>
    </ConvexProvider>
  );
}
