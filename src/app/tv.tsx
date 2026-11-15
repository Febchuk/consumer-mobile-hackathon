import { Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useNow, useQueryNow, fmt } from "@/lib/time";
import { SITE_URL } from "@/lib/convex";
import { C, F, OPTION_COLORS, tnum } from "@/lib/theme";
import { DropHeader } from "@/components/drop-header";
import { Leaderboard } from "@/components/leaderboard";
import { Card, Sparkline, TickingNumber, Wordmark, s } from "@/components/ui";

export default function TV() {
  const qnow = useQueryNow();
  const now = useNow();
  const today = useQuery(api.game.today, { now: qnow });
  const rows = useQuery(api.game.leaderboard, { now: qnow });
  const { width } = useWindowDimensions();
  const wide = width > 1000;
  const round = today?.round ?? null;
  const showBets = round && now >= round.opensAt;
  return (
    <View style={[s.screen, { padding: wide ? 36 : 16, gap: 24 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <Wordmark size={wide ? 44 : 26} />
        <Text style={{ fontFamily: F.mono, fontSize: wide ? 22 : 14, color: C.sub }}>
          join → <Text style={{ color: C.ink, fontFamily: F.monoBold }}>{SITE_URL.replace("https://", "")}</Text>
        </Text>
      </View>
      <View style={{ flex: 1, flexDirection: wide ? "row" : "column", gap: 24 }}>
        <View style={{ flex: 3, gap: 16 }}>
          <DropHeader round={round} next={today?.next ?? null} now={now} big={wide} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {showBets
              ? today?.bets.map((m) => {
                  const lead = m.options.length === 2 ? 0 : m.pct.indexOf(Math.max(...m.pct));
                  const col = OPTION_COLORS[lead % 4].fg;
                  const settled = m.status === "settled" || m.status === "refunded";
                  return (
                    <Card key={m._id} style={{ flexBasis: wide ? "47%" : "100%", flexGrow: 1, gap: 10 }}>
                      <Text style={[s.h2, wide ? { fontSize: 28, lineHeight: 34 } : null]}>{m.question}</Text>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <View>
                          <TickingNumber
                            value={m.pct[lead]}
                            suffix="%"
                            style={{ fontFamily: F.monoBold, fontSize: wide ? 84 : 54, color: col, letterSpacing: -3 }}
                          />
                          <Text style={[s.label, wide ? { fontSize: 15 } : null]}>
                            {settled
                              ? m.status === "refunded"
                                ? "refunded"
                                : "result: " + m.options[m.winningOption ?? 0]
                              : "chance " + m.options[lead]}
                          </Text>
                        </View>
                        <Sparkline
                          ticks={m.ticks}
                          start={round.opensAt}
                          end={round.locksAt}
                          now={now}
                          color={col}
                          width={wide ? 220 : 120}
                          height={wide ? 80 : 44}
                        />
                      </View>
                      <Text style={[s.sub, tnum, wide ? { fontSize: 17 } : null]}>
                        {m.options.map((o, i) => o + " " + Math.round(m.pct[i]) + "%").join("  ·  ")}  ·  pot {fmt(m.total)} ·{" "}
                        {m.bettors} in
                      </Text>
                    </Card>
                  );
                })
              : null}
          </View>
        </View>
        <View style={{ flex: 2, gap: 12 }}>
          <Text style={[s.h1, wide ? { fontSize: 40 } : null]}>Leaderboard</Text>
          {rows ? <Leaderboard rows={rows} big={wide} limit={10} /> : null}
        </View>
      </View>
    </View>
  );
}
