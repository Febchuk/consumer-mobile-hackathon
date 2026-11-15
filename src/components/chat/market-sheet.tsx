import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { useStableQuery } from "@/lib/use-stable-query";
import { useQueryNow, fmt } from "@/lib/time";
import { payoutFor } from "@/lib/odds";
import { C, tnum } from "@/lib/theme";
import { I, SYS, optColor, t } from "./ios";
import { Button, MarketChart } from "@/components/ui";

const CHIPS = [50, 100, 250];

export function optionColor(kind: string, i: number) {
  const c = optColor(kind, i);
  return { fg: c.fg, bg: c.soft, deep: c.fg };
}

export function MarketSheet({ betId, token, onClose }: { betId: Id<"bets">; token: string; onClose: () => void }) {
  const now = useQueryNow();
  const m = useStableQuery(api.chat.market, { token, betId, now });
  const stake = useMutation(api.chat.stake);
  const declare = useMutation(api.chat.declare);
  const veto = useMutation(api.chat.veto);
  const [side, setSide] = useState<number | null>(null);
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = m?.mine ? m.mine.option : side;
  const amt = Math.max(0, Math.floor(Number(amount) || 0));
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(String((e as { data?: string }).data ?? (e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(30,28,25,0.35)" }} />
      <View style={{ maxHeight: "88%", backgroundColor: I.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}>
        <View style={{ alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: C.line, marginTop: 10 }} />
        {m === undefined ? (
          <Text style={[t(14, "400", I.secondary), { padding: 24 }]}>Loading…</Text>
        ) : m === null ? (
          <View style={{ padding: 24, gap: 8 }}>
            <Text style={t(17, "600")}>🔒 Sealed</Text>
            <Text style={t(14, "400", I.secondary)}>This one's about you. You'll see it at the reveal.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 520, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 6 }}>
              <Text style={t(12, "600", I.secondary)}>
                {(m.subject ? "ABOUT " + m.subject.emoji + " @" + m.subject.name.toUpperCase() : "GROUP BET") + (m.author ? "  ·  FROM @" + m.author.name.toUpperCase() : "")}
              </Text>
              <Text style={t(24, "700")}>{m.question}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {m.options.map((o, i) => {
                const col = optionColor(m.kind, i);
                const won = m.status === "settled" && m.winningOption === i;
                const on = pick === i;
                const mult = m.pools[i] + 100 > 0 ? payoutFor(m.pools, i, 100) / 100 : 0;
                return (
                  <Pressable
                    key={i}
                    disabled={m.locked || !!m.mine || m.isSubject}
                    onPress={() => setSide(i)}
                    style={{ flex: 1, borderRadius: 14, padding: 14, gap: 4, backgroundColor: on || won ? col.fg : col.bg, borderWidth: 2, borderColor: won ? C.ink : "transparent" }}
                  >
                    <Text numberOfLines={2} style={{ fontFamily: SYS, fontWeight: "600", fontSize: 16, color: on || won ? "#fff" : col.deep }}>
                      {won ? "✓ " : ""}
                      {o}
                    </Text>
                    <Text style={[{ fontFamily: SYS, fontWeight: "700", fontSize: 28, color: on || won ? "#fff" : col.fg }, tnum]}>{Math.round(m.pct[i])}%</Text>
                    <Text style={[{ fontFamily: SYS, fontSize: 12, color: on || won ? "#fff" : col.deep }, tnum]}>
                      {m.status === "open" ? "pays " + mult.toFixed(1) + "x" : fmt(m.pools[i]) + " pts"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <MarketChart
              ticks={m.ticks.length ? m.ticks : [{ t: m.opensAt, pct: m.pct }]}
              start={m.opensAt}
              end={Math.max(m.revealAt, now)}
              now={Math.min(now, m.revealAt)}
              colors={m.options.map((_, i) => optionColor(m.kind, i).fg)}
              height={110}
              startLabel="dropped"
              endLabel={"reveal " + new Date(m.revealAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            />
            {m.canDeclare ? (
              <View style={{ gap: 10, backgroundColor: C.goldSoft, borderRadius: 14, padding: 14 }}>
                <Text style={t(17, "600")}>Your call. Honor system.</Text>
                <Text style={t(14, "400", I.secondary)}>What actually happened? Everyone's watching.</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {m.options.map((o, i) => (
                    <Button key={i} small style={{ flex: 1 }} color={optionColor(m.kind, i).fg} label={m.kind === "yesno" ? (i === 0 ? "True" : "False") : o} disabled={busy} onPress={() => run(() => declare({ token, betId, winningOption: i }))} />
                  ))}
                </View>
                {m.isSubject ? (
                  <Pressable onPress={() => run(() => veto({ token, betId }))} disabled={busy} style={{ alignSelf: "center", paddingVertical: 4 }}>
                    <Text style={t(13, "500", I.secondary)}>Too far? Veto it and everyone gets refunded</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {!m.locked && !m.isSubject ? (
              <View style={{ gap: 10 }}>
                <Text style={t(12, "600", I.secondary)}>{m.mine ? "ADD TO YOUR " + m.options[m.mine.option].toUpperCase() : "PICK A SIDE, THEN STAKE"}</Text>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <TextInput
                    value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    style={[{ width: 92, fontFamily: SYS, fontWeight: "700", fontSize: 20, color: C.ink, backgroundColor: I.fill, borderRadius: 10, borderWidth: 2, borderColor: I.blue, paddingHorizontal: 10, paddingVertical: 8 }, tnum]}
                  />
                  {CHIPS.map((c) => (
                    <Pressable key={c} onPress={() => setAmount(String(c))} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: amt === c ? I.blue : I.fill, borderWidth: 1.5, borderColor: C.line }}>
                      <Text style={{ fontFamily: SYS, fontWeight: "700", color: amt === c ? "#fff" : C.ink }}>{c}</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => setAmount(String(m.points))} style={{ paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10, backgroundColor: I.fill, borderWidth: 1.5, borderColor: C.line }}>
                    <Text style={{ fontFamily: SYS, fontWeight: "700", color: C.ink }}>ALL</Text>
                  </Pressable>
                </View>
                {pick !== null && amt > 0 ? (
                  <Text style={[t(14, "400", I.secondary), tnum]}>
                    If {m.options[pick]} lands you get ~{fmt(payoutFor(m.pools, pick, amt))} back · you have {fmt(m.points)}
                  </Text>
                ) : null}
                <Button
                  label={busy ? "Placing…" : pick === null ? "Pick a side" : "Call it · " + fmt(amt) + " on " + m.options[pick]}
                  disabled={busy || pick === null || amt < 1}
                  onPress={() => pick !== null && run(async () => { await stake({ token, betId, option: pick, amount: amt }); onClose(); })}
                />
              </View>
            ) : null}
            {err ? <Text style={{ color: C.no, fontFamily: SYS, fontWeight: "500" }}>{err}</Text> : null}
            <View style={{ gap: 8 }}>
              <Text style={t(12, "600", I.secondary)}>WHO'S ON WHAT</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {m.options.map((o, i) => (
                  <View key={i} style={{ flex: 1, gap: 6, backgroundColor: I.fill, borderRadius: 12, padding: 10, borderWidth: 1.5, borderColor: C.line }}>
                    <Text numberOfLines={1} style={{ fontFamily: SYS, fontWeight: "600", color: optionColor(m.kind, i).deep }}>{o}</Text>
                    {m.sides[i]?.length ? (
                      m.sides[i].map((p) => (
                        <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 16 }}>{p.emoji}</Text>
                          <Text numberOfLines={1} style={{ flex: 1, fontFamily: SYS, fontWeight: "500", color: C.ink2, fontSize: 13 }}>{p.me ? "you" : "@" + p.name}</Text>
                          <Text style={[{ fontFamily: SYS, fontWeight: "700", fontSize: 13, color: C.ink }, tnum]}>{fmt(p.amount)}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={[t(14, "400", I.secondary), { fontSize: 13 }]}>nobody yet</Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
