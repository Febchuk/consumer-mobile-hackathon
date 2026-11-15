import { ScrollView, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@convex/_generated/api";
import { useStableQuery } from "@/lib/use-stable-query";
import { useIdentity } from "@/lib/identity";
import { fmt, useQueryNow } from "@/lib/time";
import { Leaderboard } from "@/components/leaderboard";
import { BottomTabs, Wordmark, s } from "@/components/ui";
import { C, F, tnum } from "@/lib/theme";

export default function Board() {
  const insets = useSafeAreaInsets();
  const { token } = useIdentity();
  const qnow = useQueryNow();
  const rows = useStableQuery(api.game.leaderboard, { now: qnow });
  const me = useQuery(api.users.me, { token: token ?? undefined });
  const idx = rows && me ? rows.findIndex((r) => r._id === me._id) : -1;
  const live = rows ? rows.reduce((a, r) => a + r.live, 0) : 0;
  const inDrop = rows ? rows.filter((r) => r.inThisDrop).length : 0;
  const stats = [
    { label: "players", value: fmt(rows?.length ?? 0), color: C.ink },
    { label: "in this drop", value: fmt(inDrop), color: C.yes },
    { label: "pts riding", value: fmt(live), color: C.goldDeep },
  ];
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.column, { paddingTop: insets.top + 14, paddingBottom: 190, gap: 16 }]}>
        <Wordmark size={22} />
        <View style={{ gap: 4 }}>
          <Text style={[s.h1, { fontSize: 44, lineHeight: 46 }]}>The Board</Text>
          <Text style={s.sub}>Live = points riding on this drop. Late = picked after the first 10 minutes.</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {stats.map((st) => (
            <View key={st.label} style={{ flex: 1, backgroundColor: C.tile, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 2 }}>
              <Text style={[{ fontFamily: F.monoBold, fontSize: 22, color: st.color, letterSpacing: -0.5 }, tnum]}>{st.value}</Text>
              <Text style={[s.label, { fontSize: 9.5 }]}>{st.label}</Text>
            </View>
          ))}
        </View>
        {rows ? <Leaderboard rows={rows} highlight={me?._id} /> : <Text style={[s.sub, { color: C.faint }]}>Loading…</Text>}
      </ScrollView>
      {rows && idx >= 0 ? (
        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: Math.max(insets.bottom, 14) + 66,
            maxWidth: 488,
            alignSelf: "center",
            backgroundColor: C.ink,
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View style={{ backgroundColor: C.gold, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={[{ fontFamily: F.monoBold, fontSize: 15, color: C.ink }, tnum]}>#{idx + 1}</Text>
          </View>
          <Text style={{ fontSize: 20 }}>{rows[idx].emoji}</Text>
          <Text numberOfLines={1} style={[{ fontFamily: F.bodyBold, fontSize: 14, color: C.paper, flex: 1 }, tnum]}>
            {idx > 0 ? fmt(rows[idx - 1].points - rows[idx].points) + " behind #" + idx : "You're in the lead"}
          </Text>
          <Text style={[{ fontFamily: F.monoBold, fontSize: 18, color: C.gold }, tnum]}>{fmt(rows[idx].points)}</Text>
        </View>
      ) : null}
      <BottomTabs />
    </View>
  );
}
