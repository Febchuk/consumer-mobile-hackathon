import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useIdentity } from "@/lib/identity";
import { useStableQuery } from "@/lib/use-stable-query";
import { fmt, useQueryNow } from "@/lib/time";
import { Avatar, Stack } from "@/components/chat/thread";
import { I, t } from "@/components/chat/ios";

export default function GroupInfo() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useIdentity();
  const qnow = useQueryNow();
  const data = useStableQuery(api.chat.thread, token ? { token, groupId: id as Id<"groups">, now: qnow } : ("skip" as never));
  if (!data) return <View style={{ flex: 1, backgroundColor: I.fill }} />;
  const items = data.items as { type: string; total?: number; status?: string }[];
  const pot = items.filter((i) => i.type === "bet" || i.type === "sealed").reduce((a, i) => a + (i.total ?? 0), 0);
  const bets = items.filter((i) => i.type === "bet" || i.type === "sealed").length;
  const others = data.members.filter((m) => m._id !== data.me._id);
  const section = { backgroundColor: I.bg, borderRadius: 12, marginHorizontal: 16, overflow: "hidden" as const };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: I.fill }} contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: 60, gap: 18, maxWidth: 620, width: "100%", alignSelf: "center" }}>
      <View style={{ flexDirection: "row", paddingHorizontal: 16, height: 40, alignItems: "center" }}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: "/c/g/[id]", params: { id } }))} hitSlop={10}>
          <Text style={t(17, "600", I.blue)}>Done</Text>
        </Pressable>
      </View>
      <View style={{ alignItems: "center", gap: 8 }}>
        <Stack faces={others.map((m) => m.emoji)} size={84} />
        <Text style={t(22, "600")}>{data.group.name}</Text>
        <Text style={t(14, "400", I.secondary)}>{data.members.length} people · invite code {data.group.inviteCode}</Text>
      </View>
      <View style={[section, { padding: 16, gap: 4, alignItems: "center" }]}>
        <Text style={t(12, "600", I.secondary)}>THE DINNER POT</Text>
        <Text style={[t(40, "700"), { fontVariant: ["tabular-nums"] }]}>{fmt(pot)}</Text>
        <Text style={[t(13, "400", I.secondary), { textAlign: "center" }]}>
          {bets} bet{bets === 1 ? "" : "s"} riding. Last place after the reveal buys the first round.
        </Text>
      </View>
      <Text style={[t(13, "400", I.secondary), { marginHorizontal: 32, marginBottom: -12 }]}>LEADERBOARD</Text>
      <View style={section}>
        {data.members.map((m, i) => (
          <View key={m._id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16 }}>
            <Text style={[t(15, "600", I.secondary), { width: 18, fontVariant: ["tabular-nums"] }]}>{i + 1}</Text>
            <View style={{ paddingVertical: 8 }}>
              <Avatar emoji={m.emoji} size={36} />
            </View>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingRight: 16, borderBottomWidth: i === data.members.length - 1 ? 0 : 0.5, borderBottomColor: I.sep }}>
              <Text style={[t(17, m._id === data.me._id ? "600" : "400"), { flex: 1 }]}>
                {m.name}
                {m._id === data.me._id ? " (you)" : ""}
              </Text>
              <Text style={[t(17, "600"), { fontVariant: ["tabular-nums"] }]}>{fmt(m.points)}</Text>
            </View>
          </View>
        ))}
      </View>
      {data.aboutMe.bets > 0 ? (
        <View style={[section, { padding: 16, gap: 4 }]}>
          <Text style={t(15, "600")}>Riding on you</Text>
          <Text style={[t(15, "400", I.secondary), { fontVariant: ["tabular-nums"] }]}>
            {data.aboutMe.bets} bet{data.aboutMe.bets === 1 ? "" : "s"} · {data.aboutMe.friends} friend{data.aboutMe.friends === 1 ? "" : "s"} in · {fmt(data.aboutMe.points)} pts
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
