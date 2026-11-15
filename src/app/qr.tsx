import { Text, View, useWindowDimensions } from "react-native";
import { SITE_URL } from "@/lib/convex";
import { QR } from "@/components/qr";
import { Wordmark } from "@/components/ui";
import { C, F } from "@/lib/theme";

export default function QRPage() {
  const { width, height } = useWindowDimensions();
  const size = Math.min(width - 48, height - 200, 720);
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
      <Wordmark size={Math.max(22, size / 18)} />
      <QR value={SITE_URL} size={size} />
      <Text style={{ fontFamily: F.mono, fontSize: 14, color: C.sub }}>{SITE_URL.replace("https://", "")}</Text>
    </View>
  );
}
