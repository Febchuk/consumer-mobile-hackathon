import { useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { MyGroups, ProfileEditor } from "@/components/me-groups";
import { useQuery } from "convex/react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@convex/_generated/api";
import { useIdentity } from "@/lib/identity";
import { fmt } from "@/lib/time";
import { BottomTabs, Card, Flame, LateTag, Wordmark, s } from "@/components/ui";
import { C, F, tnum } from "@/lib/theme";

export default function Me() {
  const insets = useSafeAreaInsets();
  const { token, setToken } = useIdentity();
  const me = useQuery(api.users.me, { token: token ?? undefined });
  const history = useQuery(api.game.myHistory, { token: token ?? undefined });
  const settled = (history ?? []).filter((h) => h.status === "settled");
  const called = settled.filter((h) => h.won).length;
  const [editing, setEditing] = useState(false);
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.column, { paddingTop: insets.top + 14, paddingBottom: 120, gap: 14 }]}>
        <Wordmark size={22} />
        {me ? (
          <Card style={{ alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 48 }}>{me.emoji}</Text>
            {editing && token ? (
              <ProfileEditor token={token} name={me.name} emoji={me.emoji} onDone={() => setEditing(false)} />
            ) : (
              <Pressable onPress={() => setEditing(true)}>
                <Text style={s.h1}>@{me.name}</Text>
                <Text style={[s.sub, { textAlign: "center" }]}>tap to edit</Text>
              </Pressable>
            )}
            <View style={{ flexDirection: "row", gap: 24, marginTop: 6 }}>
              <Stat label="points" value={fmt(me.points)} />
              <View style={{ alignItems: "center", gap: 2 }}>
                <Flame n={me.streak} size={22} />
                <Text style={s.label}>streak</Text>
              </View>
              <Stat label="called" value={called + "/" + settled.length} />
            </View>
          </Card>
        ) : null}
        {token ? <MyGroups token={token} /> : null}
        <Text style={[s.label, { marginTop: 6 }]}>Your bets</Text>
        {(history ?? []).length === 0 ? <Text style={s.sub}>No bets yet. Go call something.</Text> : null}
        {(history ?? []).map((h) => {
          const result =
            h.payout === undefined ? null : h.status === "refunded" ? 0 : h.payout - h.amount;
          return (
            <View
              key={h._id}
              style={{
                backgroundColor: C.card,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: C.line,
                padding: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[s.body, { fontFamily: F.bodyMed }]} numberOfLines={2}>
                  {h.question}
                </Text>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Text style={[s.sub, tnum]}>
                    {fmt(h.amount)} on {h.pick}
                  </Text>
                  {h.late ? <LateTag /> : null}
                </View>
              </View>
              <Text
                style={[
                  { fontFamily: F.monoBold, fontSize: 16, color: result === null ? C.faint : result >= 0 ? C.yes : C.no },
                  tnum,
                ]}
              >
                {result === null ? "open" : h.status === "refunded" ? "refund" : (result >= 0 ? "+" : "−") + fmt(Math.abs(result))}
              </Text>
            </View>
          );
        })}
        <Pressable onLongPress={() => setToken(null)} style={{ alignSelf: "center", padding: 12 }}>
          <Text style={[s.sub, { color: C.faint }]}>Hold to sign out on this device</Text>
        </Pressable>
      </ScrollView>
      <BottomTabs />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: "center", gap: 2 }}>
      <Text style={[{ fontFamily: F.monoBold, fontSize: 22, color: C.ink }, tnum]}>{value}</Text>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}
