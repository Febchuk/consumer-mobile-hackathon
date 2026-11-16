import { Text, View } from "react-native";
import { C, F, tnum } from "@/lib/theme";
import { clock, hourLabel } from "@/lib/time";
import { s } from "./ui";

type Round = { number: number; title: string; opensAt: number };

const SLOT = 10 * 60 * 1000;

export function DropHeader({ round, next, now, big }: { round: Round | null; next: Round | null; now: number; big?: boolean }) {
  const k = big ? 1.8 : 1;
  const band = { backgroundColor: C.ink, borderRadius: 14 * k, paddingHorizontal: 16 * k, paddingVertical: 14 * k, gap: 10 * k };
  if (!round || now < round.opensAt) {
    return (
      <View style={band}>
        <Text style={[s.label, { color: C.gold, fontSize: 11 * k }]}>First drop</Text>
        {next ? (
          <>
            <Text style={{ fontFamily: F.display, color: C.paper, fontSize: 26 * k, letterSpacing: -0.5 }}>Doors open at {hourLabel(next.opensAt)}</Text>
            <Text style={[{ fontFamily: F.monoBold, fontSize: 52 * k, color: C.gold, letterSpacing: -2 * k, lineHeight: 56 * k }, tnum]}>
              {clock(next.opensAt - now)}
            </Text>
          </>
        ) : (
          <Text style={{ fontFamily: F.display, color: C.paper, fontSize: 26 * k }}>Coming soon</Text>
        )}
      </View>
    );
  }
  const elapsed = now - round.opensAt;
  const end = next ? next.opensAt : round.opensAt + 60 * 60 * 1000;
  const total = Math.max(SLOT, end - round.opensAt);
  const slots = Math.max(1, Math.min(12, Math.round(total / SLOT)));
  const per = total / slots;
  const onTime = elapsed < SLOT;
  return (
    <View style={band}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 * k }}>
        <Text style={{ fontFamily: F.display, fontSize: 26 * k, color: C.paper, letterSpacing: -0.5 }}>{round.title}</Text>
        <Text style={[s.label, { color: C.faint, fontSize: 10.5 * k, flex: 1 }]}>dropped {hourLabel(round.opensAt)}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 * k }}>
          <View style={{ width: 8 * k, height: 8 * k, borderRadius: 8 * k, backgroundColor: C.live }} />
          <Text style={{ fontFamily: F.bodyBold, color: C.live, fontSize: 11 * k, letterSpacing: 1.2 }}>OPEN</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 * k }}>
        <Text style={[{ fontFamily: F.monoBold, fontSize: 46 * k, lineHeight: 50 * k, color: C.gold, letterSpacing: -2 * k }, tnum]}>
          {next ? clock(next.opensAt - now) : clock(Math.max(0, end - now))}
        </Text>
        <Text style={[s.sub, { color: C.faint, fontSize: 13 * k, paddingBottom: 6 * k, flex: 1 }]}>until the next drop opens</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 4 * k }}>
        {Array.from({ length: slots }, (_, i) => {
          const fill = Math.max(0, Math.min(1, (elapsed - i * per) / per));
          const color = i === 0 ? C.yes : C.gold;
          return (
            <View key={i} style={{ flex: 1, height: 12 * k, borderRadius: 3 * k, backgroundColor: "#35312C", overflow: "hidden" }}>
              <View style={{ width: fill * 100 + "%", height: "100%", backgroundColor: color }} />
            </View>
          );
        })}
      </View>
      <Text style={[s.sub, tnum, { fontSize: 13 * k, color: onTime ? "#8FD3A6" : C.gold }]}>
        {onTime ? "On time for " + clock(SLOT - elapsed) + " more" : "Picks still count, but now get a LATE tag"}
      </Text>
    </View>
  );
}
