import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { api } from "@convex/_generated/api";
import { useStableQuery } from "@/lib/use-stable-query";
import { useNow, useQueryNow, fmt, hourLabel } from "@/lib/time";
import { SITE_URL } from "@/lib/convex";
import { C, F, OPTION_COLORS, tnum } from "@/lib/theme";
import { DropHeader } from "@/components/drop-header";
import { Leaderboard } from "@/components/leaderboard";
import { Market, leadOf, sinceDrop } from "@/components/market-card";
import { QR } from "@/components/qr";
import { Delta, MarketChart, TickingNumber, Wordmark, s } from "@/components/ui";

function BigBet({ m, start, end, now, k }: { m: Market; start: number; end: number; now: number; k: number }) {
  const lead = leadOf(m);
  const col = OPTION_COLORS[lead % 4];
  const settled = m.status === "settled" || m.status === "refunded";
  return (
    <View style={{ borderTopWidth: 3, borderTopColor: C.ink, paddingTop: 16 * k, gap: 12 * k }}>
      <Text style={[s.label, { fontSize: 13 * k, color: C.ink }]}>On the big screen · {fmt(m.total)} pts · {m.bettors} in</Text>
      <Text style={{ fontFamily: F.display, fontSize: 38 * k, lineHeight: 44 * k, color: C.ink, letterSpacing: -1 }}>{m.question}</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 18 * k }}>
        {settled ? (
          <Text style={{ fontFamily: F.display, fontSize: 84 * k, lineHeight: 90 * k, color: m.status === "refunded" ? C.sub : col.fg, textTransform: "uppercase" }}>
            {m.status === "refunded" ? "Void" : m.options[lead]}
          </Text>
        ) : (
          <TickingNumber value={m.pct[lead]} suffix="%" style={{ fontFamily: F.monoBold, fontSize: 96 * k, lineHeight: 100 * k, color: col.fg, letterSpacing: -4 * k }} />
        )}
        <View style={{ paddingBottom: 12 * k, gap: 4 * k }}>
          <Text style={[s.label, { fontSize: 16 * k, color: C.ink }]}>{settled ? "the result" : m.options[lead] + " chance"}</Text>
          {settled ? null : <Delta value={sinceDrop(m, lead)} size={18 * k} suffix="since drop" />}
        </View>
      </View>
      <MarketChart
        ticks={m.ticks}
        start={start}
        end={end}
        now={now}
        colors={m.options.map((_, i) => OPTION_COLORS[i % 4].fg)}
        focus={lead}
        all
        height={k > 1 ? 150 : 160}
        big={k * 1.2}
        startLabel={hourLabel(start)}
        endLabel={"next drop " + hourLabel(end)}
      />
      <View style={{ flexDirection: "row", gap: 10 * k }}>
        {m.options.map((o, i) => {
          const c = OPTION_COLORS[i % 4];
          return (
            <View key={i} style={{ flex: 1, backgroundColor: c.bg, borderRadius: 10 * k, paddingVertical: 12 * k, paddingHorizontal: 16 * k, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 20 * k, color: c.deep, textTransform: "uppercase", flexShrink: 1 }}>{o}</Text>
              <Text style={[{ fontFamily: F.monoBold, fontSize: 26 * k, color: c.deep }, tnum]}>{Math.round(m.pct[i])}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function TV() {
  const qnow = useQueryNow();
  const now = useNow();
  const today = useStableQuery(api.game.today, { now: qnow });
  const rows = useStableQuery(api.game.leaderboard, { now: qnow });
  const { width } = useWindowDimensions();
  const wide = width > 1000;
  const k = wide ? 1.2 : 0.75;
  const round = today?.round ?? null;
  const bets = round && now >= round.opensAt ? today?.bets ?? [] : [];
  const featured = bets.length ? Math.floor(now / 15000) % bets.length : 0;
  const rest = bets.filter((_, i) => i !== featured);
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ flexGrow: 1, padding: wide ? 40 : 16 }}>
      <View style={{ flexGrow: 1, flexDirection: wide ? "row" : "column", gap: wide ? 44 : 24 }}>
        <View style={{ flex: 3, gap: 20 }}>
          <Wordmark size={wide ? 46 : 26} />
          {today ? <DropHeader round={round} next={today.next} now={now} big={wide} /> : null}
          {bets.length ? (
            <BigBet m={bets[featured]} start={round!.opensAt} end={today?.next?.opensAt ?? round!.opensAt + 3600000} now={now} k={k} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {rest.map((m) => {
              const lead = leadOf(m);
              const c = OPTION_COLORS[lead % 4];
              const settled = m.status === "settled" || m.status === "refunded";
              return (
                <View key={m._id} style={{ flexBasis: wide ? "30%" : "100%", flexGrow: 1, backgroundColor: c.bg, borderRadius: 12, padding: 14 * k, gap: 4 }}>
                  <Text numberOfLines={2} style={{ fontFamily: F.bodyBold, fontSize: 18 * k, color: C.ink, lineHeight: 23 * k }}>
                    {m.question}
                  </Text>
                  <Text style={[{ fontFamily: F.monoBold, fontSize: 40 * k, color: c.deep, letterSpacing: -1 }, tnum]}>
                    {m.status === "settled" ? m.options[m.winningOption ?? 0].toUpperCase() : m.status === "refunded" ? "VOID" : Math.round(m.pct[lead]) + "%"}{" "}
                    <Text style={[s.label, { fontSize: 14 * k, color: c.deep }]}>{settled ? "result" : m.options[lead]}</Text>
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
        <View style={{ flex: 2, gap: 18 }}>
          <View style={{ flexDirection: "row", gap: 18, alignItems: "center", backgroundColor: C.gold, borderRadius: 16, padding: 16 }}>
            <View style={{ backgroundColor: "#fff", borderRadius: 8, padding: 6 }}>
              <QR value={SITE_URL} size={wide ? 180 : 110} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ fontFamily: F.display, fontSize: 40 * k, lineHeight: 44 * k, color: C.ink, letterSpacing: -1 }}>Scan to play</Text>
              <Text style={[{ fontFamily: F.mono, fontSize: 15 * k, color: C.ink }]}>{SITE_URL.replace("https://", "")}</Text>
              <Text style={[{ fontFamily: F.monoBold, fontSize: 30 * k, color: C.ink }, tnum]}>{today?.players ?? 0} players</Text>
            </View>
          </View>
          <Text style={{ fontFamily: F.display, fontSize: 40 * k, color: C.ink, letterSpacing: -1 }}>Top 8</Text>
          {rows ? <Leaderboard rows={rows} big={wide} limit={8} /> : null}
        </View>
      </View>
    </ScrollView>
  );
}
