import { ScrollView, Text, View, Pressable } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useStableQuery } from "@/lib/use-stable-query";
import { useIdentity } from "@/lib/identity";
import { C, F } from "@/lib/theme";
import { useNow, useQueryNow } from "@/lib/time";
import { multiplier } from "@/lib/odds";
import { Join } from "@/components/join";
import { DropHeader } from "@/components/drop-header";
import { DropLands, useDropSeen } from "@/components/drop-lands";
import { MarketCard } from "@/components/market-card";
import { BottomTabs, Card, Flame, TickingNumber, Wordmark, s } from "@/components/ui";

export default function Today() {
  const { token, ready } = useIdentity();
  const qnow = useQueryNow();
  const now = useNow();
  const me = useQuery(api.users.me, { token: token ?? undefined });
  const today = useStableQuery(api.game.today, { token: token ?? undefined, now: qnow });
  const round = today?.round ?? null;
  const live = !!round && now >= round.opensAt && now < round.locksAt;
  const drop = useDropSeen(live && today && today.bets.length > 0 ? round?._id : undefined);

  if (!ready || (token && me === undefined)) return <View style={s.screen} />;
  if (!token || me === null) return <Join />;
  if (!me) return <View style={s.screen} />;
  if (live && round && drop.show) return <DropLands round={round} count={today?.bets.length ?? 0} now={now} onDone={drop.markSeen} />;

  const mult = multiplier(today?.streak.next ?? 1);
  const streakShown = today?.streak.shown ?? 0;
  const ctx = {
    token,
    points: me.points,
    mult,
    roundStart: round?.opensAt ?? 0,
    roundLock: round?.locksAt ?? 0,
    now,
    late: !!round && now - round.opensAt > 10 * 60 * 1000,
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.column, { paddingTop: 20, paddingBottom: 120, gap: 14 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Wordmark size={22} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 30 }}>{me.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.displaySemi, fontSize: 20, color: C.ink }}>{me.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Flame n={streakShown} />
              <Text style={s.sub}>{mult > 1 ? "+" + Math.round((mult - 1) * 100) + "% on wins this drop" : "bet every drop to build a streak"}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <TickingNumber value={me.points} style={{ fontFamily: F.monoBold, fontSize: 26, color: C.ink }} />
            <Text style={s.label}>points</Text>
          </View>
        </View>

        {today ? <DropHeader round={round} next={today.next} now={now} /> : null}

        {round && now >= round.opensAt ? today?.bets.map((m) => <MarketCard key={m._id} m={m} ctx={ctx} />) : null}
        {live && today?.bets.length === 0 ? (
          <Card>
            <Text style={s.body}>Bets for this drop are on their way.</Text>
          </Card>
        ) : null}
        {!round ? (
          <Card style={{ gap: 8 }}>
            <Text style={s.h2}>How it works</Text>
            <Text style={[s.body, { color: C.sub, lineHeight: 22 }]}>
              Every hour a drop of bets lands for everyone at once. Pick a side and stake points. Winners split the whole pot by
              stake, so the long shot pays the most. Bet every drop to grow your streak: +10% on wins per drop in a row, up to 2x.
              Picks after the first 10 minutes are tagged late. Betting locks at :50.
            </Text>
          </Card>
        ) : null}
      </ScrollView>
      <BottomTabs />
    </View>
  );
}
