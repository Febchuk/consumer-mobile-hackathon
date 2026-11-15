import { ScrollView, Text, View, Pressable } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useIdentity } from "@/lib/identity";
import { C, F, tnum } from "@/lib/theme";
import { fmt, useNow, useQueryNow } from "@/lib/time";
import { multiplier } from "@/lib/odds";
import { Join } from "@/components/join";
import { DropHeader } from "@/components/drop-header";
import { MarketCard } from "@/components/market-card";
import { Flame, NavTabs, TickingNumber, Wordmark, s, Card } from "@/components/ui";

export default function Today() {
  const { token, ready, setToken } = useIdentity();
  const qnow = useQueryNow();
  const now = useNow();
  const me = useQuery(api.users.me, { token: token ?? undefined });
  const today = useQuery(api.game.today, { token: token ?? undefined, now: qnow });
  if (!ready || (token && me === undefined)) return <View style={s.screen} />;
  if (!token || me === null) return <Join />;
  if (!me) return <View style={s.screen} />;

  const round = today?.round ?? null;
  const live = round && now >= round.opensAt && now < round.locksAt;
  const nextStreak =
    round && me.lastRoundNumber === round.number
      ? me.streak
      : round && me.lastRoundNumber === round.number - 1
        ? me.streak + 1
        : 1;
  const mult = multiplier(nextStreak);
  const streakShown = round && me.lastRoundNumber !== undefined && me.lastRoundNumber >= round.number - 1 ? me.streak : 0;
  const late = !!round && now - round.opensAt > 10 * 60 * 1000;

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.column, { paddingTop: 20, paddingBottom: 60, gap: 14 }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark size={22} />
        <NavTabs />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
        <Text style={{ fontSize: 30 }}>{me.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Pressable onLongPress={() => setToken(null)}>
            <Text style={{ fontFamily: F.displaySemi, fontSize: 20, color: C.ink }}>{me.name}</Text>
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Flame n={streakShown} />
            <Text style={s.sub}>{mult > 1 ? "×" + mult.toFixed(1) + " on wins this drop" : "bet every drop to build a streak"}</Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <TickingNumber value={me.points} style={{ fontFamily: F.monoBold, fontSize: 26, color: C.ink }} />
          <Text style={s.label}>points</Text>
        </View>
      </View>

      <DropHeader round={round} next={today?.next ?? null} now={now} />

      {round && (live || now >= round.locksAt)
        ? today?.bets.map((m) => (
            <MarketCard
              key={m._id}
              m={m}
              token={token}
              points={me.points}
              mult={mult}
              roundStart={round.opensAt}
              roundLock={round.locksAt}
              now={now}
              late={late}
            />
          ))
        : null}
      {round && live && today?.bets.length === 0 ? (
        <Card>
          <Text style={s.body}>Bets for this drop are on their way.</Text>
        </Card>
      ) : null}
      {!round ? (
        <Card style={{ gap: 8 }}>
          <Text style={s.h2}>How it works</Text>
          <Text style={[s.body, { color: C.sub, lineHeight: 22 }]}>
            Every hour a drop of bets lands for everyone at once. Pick a side and stake points. Winners split the whole pot by
            stake, so the long shot pays the most. Picks after the first 10 minutes are tagged late. Betting locks at :50.
          </Text>
        </Card>
      ) : null}
      <Text style={[s.sub, tnum, { textAlign: "center", marginTop: 8 }]}>
        Started with 1,000 · now {fmt(me.points)}
      </Text>
    </ScrollView>
  );
}
