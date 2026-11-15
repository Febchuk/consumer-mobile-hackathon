import { Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useStableQuery } from "@/lib/use-stable-query";
import { useNow, useQueryNow, fmt } from "@/lib/time";
import { SITE_URL } from "@/lib/convex";
import { C, F, OPTION_COLORS, tnum } from "@/lib/theme";
import { DropHeader } from "@/components/drop-header";
import { Leaderboard } from "@/components/leaderboard";
import { Market } from "@/components/market-card";
import { QR } from "@/components/qr";
import { Card, Sparkline, TickingNumber, Wordmark, s } from "@/components/ui";

function BigBet({ m, start, end, now, k }: { m: Market; start: number; end: number; now: number; k: number }) {
  const lead = m.status === "settled" && m.winningOption !== undefined ? m.winningOption : m.pct.indexOf(Math.max(...m.pct));
  const col = OPTION_COLORS[lead % 4].fg;
  const settled = m.status === "settled" || m.status === "refunded";
  return (
    <Card style={{ gap: 10 * k, padding: 22 * k }}>
      <Text style={[s.h2, { fontSize: 24 * k, lineHeight: 30 * k }]}>{m.question}</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          {settled ? (
            <Text style={{ fontFamily: F.display, fontSize: 60 * k, color: m.status === "refunded" ? C.sub : col, textTransform: "uppercase" }}>
              {m.status === "refunded" ? "Void" : m.options[lead]}
            </Text>
          ) : (
            <TickingNumber value={m.pct[lead]} suffix="%" style={{ fontFamily: F.monoBold, fontSize: 64 * k, color: col, letterSpacing: -3 }} />
          )}
          <Text style={[s.label, tnum, { fontSize: 12 * k }]}>
            {settled
              ? m.status === "refunded"
                ? "refunded · nobody called it"
                : "what happened · " + Math.round(m.pct[lead]) + "% called it"
              : "say " + m.options[lead]}
          </Text>
        </View>
        <Sparkline ticks={m.ticks} start={start} end={end} now={now} color={col} index={lead} width={180 * k} height={64 * k} />
      </View>
      <Text style={[s.sub, tnum, { fontSize: 14 * k }]}>
        {m.options.map((o, i) => o + " " + Math.round(m.pct[i]) + "%").join("  ·  ")}  ·  {fmt(m.total)} pts in · {m.bettors} bettors
      </Text>
    </Card>
  );
}

export default function TV() {
  const qnow = useQueryNow();
  const now = useNow();
  const today = useStableQuery(api.game.today, { now: qnow });
  const rows = useStableQuery(api.game.leaderboard, { now: qnow });
  const { width } = useWindowDimensions();
  const wide = width > 1000;
  const k = wide ? 1.3 : 0.85;
  const round = today?.round ?? null;
  const bets = round && now >= round.opensAt ? today?.bets ?? [] : [];
  const featured = bets.length ? Math.floor(now / 15000) % bets.length : 0;
  const rest = bets.filter((_, i) => i !== featured);
  return (
    <View style={[s.screen, { padding: wide ? 36 : 16, gap: 24 }]}>
      <View style={{ flex: 1, flexDirection: wide ? "row" : "column", gap: 28 }}>
        <View style={{ flex: 3, gap: 18 }}>
          <Wordmark size={wide ? 44 : 26} />
          {today ? <DropHeader round={round} next={today.next} now={now} big={wide} /> : null}
          {bets.length ? (
            <BigBet m={bets[featured]} start={round!.opensAt} end={today?.next?.opensAt ?? round!.opensAt + 3600000} now={now} k={k} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
            {rest.map((m) => {
              const lead = m.status === "settled" && m.winningOption !== undefined ? m.winningOption : m.pct.indexOf(Math.max(...m.pct));
              return (
                <Card key={m._id} style={{ flexBasis: wide ? "30%" : "100%", flexGrow: 1, gap: 4 }}>
                  <Text numberOfLines={2} style={[s.body, { fontFamily: F.bodyBold, fontSize: 15 * k }]}>
                    {m.question}
                  </Text>
                  <Text style={[{ fontFamily: F.monoBold, fontSize: 30 * k, color: OPTION_COLORS[lead % 4].fg }, tnum]}>
                    {m.status === "settled" ? m.options[m.winningOption ?? 0].toUpperCase() : m.status === "refunded" ? "VOID" : Math.round(m.pct[lead]) + "%"}{" "}
                    <Text style={[s.label, { fontSize: 12 * k }]}>{m.status === "settled" || m.status === "refunded" ? "result" : m.options[lead]}</Text>
                  </Text>
                </Card>
              );
            })}
          </View>
        </View>
        <View style={{ flex: 2, gap: 14 }}>
          <View style={{ flexDirection: "row", gap: 16, alignItems: "center", backgroundColor: C.card, borderRadius: 20, borderWidth: 1.5, borderColor: C.line, padding: 14 }}>
            <QR value={SITE_URL} size={wide ? 170 : 110} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[s.h2, { fontSize: 26 * k }]}>Scan to play</Text>
              <Text style={[s.sub, { fontSize: 14 * k }]}>{SITE_URL.replace("https://", "")}</Text>
              <Text style={[{ fontFamily: F.monoBold, fontSize: 22 * k, color: C.yes }, tnum]}>{today?.players ?? 0} players</Text>
            </View>
          </View>
          <Text style={[s.h1, { fontSize: 30 * k }]}>Top 8</Text>
          {rows ? <Leaderboard rows={rows} big={wide} limit={8} /> : null}
        </View>
      </View>
    </View>
  );
}
