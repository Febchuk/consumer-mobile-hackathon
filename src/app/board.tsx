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
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.column, { paddingTop: insets.top + 14, paddingBottom: 180, gap: 14 }]}>
        <Wordmark size={22} />
        <Text style={s.h1}>Board</Text>
        <Text style={[s.sub, { marginTop: -8 }]}>Live = points riding on this drop. Late = picked after the first 10 minutes.</Text>
        {rows ? <Leaderboard rows={rows} highlight={me?._id} /> : <Text style={[s.sub, { color: C.faint }]}>Loading…</Text>}
      </ScrollView>
      {rows && idx >= 0 ? (
        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 86,
            maxWidth: 488,
            alignSelf: "center",
            backgroundColor: C.ink,
            borderRadius: 16,
            paddingVertical: 12,
            paddingHorizontal: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 20 }}>{rows[idx].emoji}</Text>
          <Text style={[{ fontFamily: F.bodyBold, fontSize: 15, color: "#fff", flex: 1 }, tnum]}>
            You · #{idx + 1}
            {idx > 0 ? "  ·  " + fmt(rows[idx - 1].points - rows[idx].points) + " behind #" + idx : "  ·  in the lead"}
          </Text>
          <Text style={[{ fontFamily: F.monoBold, fontSize: 16, color: C.gold }, tnum]}>{fmt(rows[idx].points)}</Text>
        </View>
      ) : null}
      <BottomTabs />
    </View>
  );
}
