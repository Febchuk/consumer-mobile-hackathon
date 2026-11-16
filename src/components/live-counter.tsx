import { Text, View } from "react-native";
import { C, F, tnum } from "@/lib/theme";
import { TickingNumber } from "./ui";

export function LiveCounter({ count, line, scale = 1, settled }: { count: number; line: number; scale?: number; settled?: boolean }) {
  const over = count > line;
  const need = Math.ceil(line - count);
  return (
    <View style={{ backgroundColor: C.ink, borderRadius: 18 * scale, padding: 18 * scale, gap: 4 * scale }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {!settled ? <View style={{ width: 10 * scale, height: 10 * scale, borderRadius: 10, backgroundColor: C.no }} /> : null}
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12 * scale, letterSpacing: 1.5, color: settled ? C.faint : C.no }}>
          {settled ? "FINAL COUNT" : "LIVE COUNT"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14 * scale }}>
        <TickingNumber value={count} style={{ fontFamily: F.monoBold, fontSize: 120 * scale, lineHeight: 124 * scale, letterSpacing: -6 * scale, color: over ? C.gold : "#fff" }} />
        <View style={{ paddingBottom: 18 * scale, gap: 2 }}>
          <Text style={[{ fontFamily: F.mono, fontSize: 16 * scale, color: C.faint }, tnum]}>line {line}</Text>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 16 * scale, color: over ? C.gold : "#fff" }}>
            {over ? "OVER is hitting" : need + " more for OVER"}
          </Text>
        </View>
      </View>
    </View>
  );
}
