import { Text, View } from "react-native";
import { C, F, tnum } from "@/lib/theme";
import { fmt } from "@/lib/time";
import { Flame, LateTag } from "./ui";

export type Row = {
  _id: string;
  name: string;
  emoji: string;
  points: number;
  streak: number;
  live: number;
  late: boolean;
  online: boolean;
};

const MEDALS = [C.gold, "#A9B4BE", "#C98A5B"];

export function Leaderboard({ rows, highlight, big, limit }: { rows: Row[]; highlight?: string; big?: boolean; limit?: number }) {
  const k = big ? 1.5 : 1;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <View>
      <View style={{ flexDirection: "row", paddingHorizontal: 6 * k, paddingBottom: 6 * k, gap: 10 * k, borderBottomWidth: 2, borderBottomColor: C.ink }}>
        <Text style={[head(k), { width: 28 * k }]}>#</Text>
        <Text style={[head(k), { flex: 1 }]}>Player</Text>
        <Text style={[head(k), { width: 34 * k, textAlign: "right" }]}>Strk</Text>
        <Text style={[head(k), { width: 50 * k, textAlign: "right" }]}>Live</Text>
        <Text style={[head(k), { width: 66 * k, textAlign: "right" }]}>Points</Text>
      </View>
      {shown.map((r, i) => {
        const medal = MEDALS[i];
        const mine = r._id === highlight;
        return (
          <View
            key={r._id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10 * k,
              backgroundColor: mine ? C.goldSoft : "transparent",
              borderBottomWidth: 1,
              borderBottomColor: C.line,
              paddingHorizontal: 6 * k,
              paddingVertical: (i < 3 ? 11 : 9) * k,
            }}
          >
            <View
              style={{
                width: 28 * k,
                height: 30 * k,
                borderRadius: 5 * k,
                backgroundColor: medal ?? "transparent",
                borderWidth: medal ? 0 : 1.5,
                borderColor: C.line,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={[{ fontFamily: F.monoBold, fontSize: 14 * k, color: medal ? "#fff" : C.sub }, tnum]}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 7 * k, minWidth: 0 }}>
              <View>
                <Text style={{ fontSize: 22 * k }}>{r.emoji}</Text>
                {r.online ? (
                  <View style={{ position: "absolute", right: -2, bottom: 1, width: 8 * k, height: 8 * k, borderRadius: 8, backgroundColor: C.live, borderWidth: 1.5, borderColor: mine ? C.goldSoft : C.paper }} />
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ fontFamily: i < 3 ? F.bodyBold : F.bodyMed, fontSize: 15 * k, color: C.ink, flexShrink: 1 }}>
                @{r.name}
              </Text>
              {r.late ? <LateTag /> : null}
            </View>
            <View style={{ width: 34 * k, alignItems: "flex-end" }}>
              <Flame n={r.streak} size={13 * k} />
            </View>
            <View style={{ width: 50 * k, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
              <Text style={[{ fontFamily: F.mono, fontSize: 13 * k, color: r.live > 0 ? C.live : C.faint }, tnum]}>
                {r.live > 0 ? fmt(r.live) : "–"}
              </Text>
            </View>
            <Text style={[{ width: 66 * k, textAlign: "right", fontFamily: F.monoBold, fontSize: (i < 3 ? 17 : 15) * k, color: C.ink }, tnum]}>
              {fmt(r.points)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const head = (k: number) => ({
  fontFamily: F.bodyBold,
  fontSize: 10 * k,
  color: C.ink,
  letterSpacing: 1.3,
  textTransform: "uppercase" as const,
});
