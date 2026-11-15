import { ScrollView, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useIdentity } from "@/lib/identity";
import { useQueryNow } from "@/lib/time";
import { Leaderboard } from "@/components/leaderboard";
import { NavTabs, Wordmark, s } from "@/components/ui";
import { C } from "@/lib/theme";

export default function Board() {
  const { token } = useIdentity();
  const qnow = useQueryNow();
  const rows = useQuery(api.game.leaderboard, { now: qnow });
  const me = useQuery(api.users.me, { token: token ?? undefined });
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.column, { paddingTop: 20, paddingBottom: 60, gap: 14 }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark size={22} />
        <NavTabs />
      </View>
      <Text style={s.h1}>Leaderboard</Text>
      <Text style={[s.sub, { marginTop: -8 }]}>Live = points riding on this drop. Late = picked after the first 10 minutes.</Text>
      {rows ? <Leaderboard rows={rows} highlight={me?._id} /> : <Text style={[s.sub, { color: C.faint }]}>Loading…</Text>}
    </ScrollView>
  );
}
