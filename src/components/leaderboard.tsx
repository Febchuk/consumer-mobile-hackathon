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

export function Leaderboard({ rows, highlight, big, limit }: { rows: Row[]; highlight?: string; big?: boolean; limit?: number }) {
  const k = big ? 1.5 : 1;
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <View style={{ gap: 6 * k }}>
      <View style={{ flexDirection: "row", paddingHorizontal: 12 * k, gap: 10 * k }}>
        <Text style={[head(k), { width: 26 * k }]}>#</Text>
        <Text style={[head(k), { flex: 1 }]}>Player</Text>
        <Text style={[head(k), { width: 44 * k, textAlign: "right" }]}>Strk</Text>
        <Text style={[head(k), { width: 64 * k, textAlign: "right" }]}>Live</Text>
        <Text style={[head(k), { width: 72 * k, textAlign: "right" }]}>Points</Text>
      </View>
      {shown.map((r, i) => {
        const top = i < 3;
        const tile = i === 0 ? C.gold : i === 1 ? "#A9B4BE" : i === 2 ? "#C98A5B" : C.tile;
        return (
          <View
            key={r._id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10 * k,
              backgroundColor: r._id === highlight ? C.goldSoft : C.card,
              borderRadius: 14 * k,
              borderWidth: 1.5,
              borderColor: r._id === highlight ? C.gold : C.line,
              paddingHorizontal: 12 * k,
              paddingVertical: 10 * k,
            }}
          >
            <View
              style={{
                width: 26 * k,
                height: 26 * k,
                borderRadius: 7 * k,
                backgroundColor: tile,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={[{ fontFamily: F.monoBold, fontSize: 13 * k, color: top ? "#fff" : C.sub }, tnum]}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 * k, minWidth: 0 }}>
              <Text style={{ fontSize: 20 * k }}>{r.emoji}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15 * k, color: C.ink, flexShrink: 1 }}>
                {r.name}
              </Text>
              {r.late ? <LateTag /> : null}
            </View>
            <View style={{ width: 44 * k, alignItems: "flex-end" }}>
              <Flame n={r.streak} size={13 * k} />
            </View>
            <View style={{ width: 64 * k, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
              {r.live > 0 ? <View style={{ width: 6 * k, height: 6 * k, borderRadius: 6, backgroundColor: C.live }} /> : null}
              <Text style={[{ fontFamily: F.mono, fontSize: 13 * k, color: r.live > 0 ? C.live : C.faint }, tnum]}>
                {r.live > 0 ? fmt(r.live) : "–"}
              </Text>
            </View>
            <Text style={[{ width: 72 * k, textAlign: "right", fontFamily: F.monoBold, fontSize: 15 * k, color: C.ink }, tnum]}>
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
  color: C.sub,
  letterSpacing: 1,
  textTransform: "uppercase" as const,
});
