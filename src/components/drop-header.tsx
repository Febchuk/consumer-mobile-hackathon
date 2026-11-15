import { Text, View } from "react-native";
import { C, F, tnum } from "@/lib/theme";
import { clock, hourLabel } from "@/lib/time";
import { Card, s } from "./ui";

type Round = { number: number; title: string; opensAt: number; locksAt: number };

export function DropHeader({ round, next, now, big }: { round: Round | null; next: Round | null; now: number; big?: boolean }) {
  const scale = big ? 1.8 : 1;
  if (!round || now >= round.locksAt) {
    return (
      <Card style={{ gap: 6, backgroundColor: C.ink, borderColor: C.ink }}>
        <Text style={[s.label, { color: C.faint, fontSize: 11 * scale }]}>
          {round ? round.title + " is locked" : "First drop"}
        </Text>
        {next ? (
          <>
            <Text style={{ fontFamily: F.displaySemi, color: "#fff", fontSize: 18 * scale }}>
              Next drop at {hourLabel(next.opensAt)}
            </Text>
            <Text style={[{ fontFamily: F.monoBold, fontSize: 44 * scale, color: C.gold, letterSpacing: -1 }, tnum]}>
              {clock(next.opensAt - now)}
            </Text>
          </>
        ) : (
          <Text style={{ fontFamily: F.displaySemi, color: "#fff", fontSize: 18 * scale }}>Next drop coming soon</Text>
        )}
      </Card>
    );
  }
  const elapsed = now - round.opensAt;
  const total = round.locksAt - round.opensAt;
  const onTime = elapsed < 10 * 60 * 1000;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={[s.label, { fontSize: 11 * scale }]}>
          {round.title} · dropped {hourLabel(round.opensAt)}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 8 * scale, height: 8 * scale, borderRadius: 8, backgroundColor: C.live }} />
          <Text style={{ fontFamily: F.bodyBold, color: C.live, fontSize: 12 * scale }}>LIVE</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
        <Text style={[{ fontFamily: F.monoBold, fontSize: 40 * scale, color: C.ink, letterSpacing: -1 }, tnum]}>
          {clock(round.locksAt - now)}
        </Text>
        <Text style={[s.sub, { fontSize: 13 * scale }]}>until betting locks</Text>
      </View>
      <View style={{ height: 8 * scale, backgroundColor: C.tile, borderRadius: 8, overflow: "hidden", flexDirection: "row" }}>
        <View style={{ width: (100 * Math.min(elapsed, total)) / total + "%", backgroundColor: onTime ? C.yes : C.gold }} />
      </View>
      <Text style={[s.sub, tnum, { fontSize: 13 * scale, color: onTime ? C.yes : "#9A6B12" }]}>
        {onTime ? "On time for " + clock(10 * 60 * 1000 - elapsed) + " more" : "Picks now get a late tag"}
      </Text>
    </Card>
  );
}
