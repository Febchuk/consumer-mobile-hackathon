import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View, Platform } from "react-native";
import { useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { C, F, OPTION_COLORS, tnum } from "@/lib/theme";
import { payoutFor } from "@/lib/odds";
import { fmt } from "@/lib/time";
import { Card, LateTag, Sparkline, Tag, TickingNumber, s } from "./ui";

export type Market = {
  _id: Id<"bets">;
  question: string;
  kind: "yesno" | "overunder" | "multi";
  options: string[];
  line?: number;
  pools: number[];
  pct: number[];
  total: number;
  bettors: number;
  locked: boolean;
  status: "open" | "locked" | "settled" | "refunded";
  winningOption?: number;
  ticks: { t: number; pct: number[] }[];
  mine: { option: number; amount: number; late: boolean; payout?: number }[];
};

type Ctx = { token: string | null; points: number; mult: number; roundStart: number; roundLock: number; now: number; late: boolean };

function errorText(e: unknown) {
  const msg = (e as { data?: string })?.data ?? (e as Error)?.message ?? "Something went wrong";
  return typeof msg === "string" ? msg.replace(/^.*ConvexError: /, "").split("\n")[0] : "Something went wrong";
}

function multipleText(pools: number[], i: number, mult: number) {
  const x = payoutFor(pools, i, 100, mult) / 100;
  return x.toFixed(x >= 10 ? 0 : 1) + "x";
}

export function MarketCard({ m, ctx }: { m: Market; ctx: Ctx }) {
  const [sheet, setSheet] = useState<number | null>(null);
  const locked = m.locked || ctx.now >= ctx.roundLock;
  const settled = m.status === "settled" || m.status === "refunded";
  const lead = m.status === "settled" && m.winningOption !== undefined ? m.winningOption : m.pct.indexOf(Math.max(...m.pct));
  const leadColor = locked && !settled ? C.sub : OPTION_COLORS[lead % 4].fg;
  const staked = m.mine.reduce((a, p) => a + p.amount, 0);
  const myOption = m.mine[0]?.option;
  const myLate = m.mine.some((p) => p.late);
  const myPayout = m.mine.every((p) => p.payout !== undefined) && m.mine.length ? m.mine.reduce((a, p) => a + (p.payout ?? 0), 0) : undefined;
  const kindLabel = m.kind === "yesno" ? "Yes / No" : m.kind === "overunder" ? "Over / Under" : "Pick one";

  return (
    <Card style={{ gap: 14, opacity: locked && !settled ? 0.92 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Tag label={kindLabel} />
        {settled ? (
          <Tag label={m.status === "refunded" ? "refunded" : "settled"} color="#fff" bg={C.ink} />
        ) : locked ? (
          <Tag label="locked" color={C.no} bg={C.noSoft} />
        ) : (
          <Tag label="live" color={C.live} bg={C.yesSoft} />
        )}
        <View style={{ flex: 1 }} />
        <Text style={[s.sub, tnum]}>
          {m.bettors} in · pot <Text style={{ fontFamily: F.mono, color: C.ink }}>{fmt(m.total)}</Text>
        </Text>
      </View>

      <Text style={s.h2}>{m.question}</Text>

      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <TickingNumber
              value={m.pct[lead]}
              style={{ fontFamily: F.monoBold, fontSize: 54, color: leadColor, letterSpacing: -2, lineHeight: 58 }}
            />
            <Text style={{ fontFamily: F.monoBold, fontSize: 22, color: leadColor, marginTop: 6 }}>%</Text>
          </View>
          <Text style={[s.label, { marginTop: 2 }]}>
            {settled
              ? m.status === "refunded"
                ? "nobody called it · refunded"
                : "result: " + m.options[m.winningOption ?? 0]
              : m.options[lead]}
          </Text>
        </View>
        <Sparkline ticks={m.ticks} start={ctx.roundStart} end={ctx.roundLock} now={ctx.now} color={leadColor} index={lead} />
      </View>

      {staked > 0 ? (
        <View
          style={{
            backgroundColor: OPTION_COLORS[myOption % 4].bg,
            borderRadius: 14,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[{ fontFamily: F.bodyBold, fontSize: 15, color: C.ink }, tnum]}>
                You: <Text style={{ fontFamily: F.monoBold }}>{fmt(staked)}</Text> on{" "}
                <Text style={{ color: OPTION_COLORS[myOption % 4].fg }}>{m.options[myOption]}</Text>
              </Text>
              {myLate ? <LateTag /> : null}
            </View>
            {myPayout === undefined ? (
              <Text style={[s.sub, tnum, { fontFamily: F.mono, fontSize: 12 }]}>
                → wins {fmt(payoutFor(m.pools.map((p, i) => (i === myOption ? p - staked : p)), myOption, staked, ctx.mult))} right now
              </Text>
            ) : null}
          </View>
          {myPayout !== undefined ? (
            <Text style={[{ fontFamily: F.monoBold, fontSize: 20, color: myPayout >= staked ? C.yes : C.no }, tnum]}>
              {m.status === "refunded" ? "refund" : myPayout > 0 ? "+" + fmt(myPayout) : "−" + fmt(staked)}
            </Text>
          ) : !locked ? (
            <Pressable onPress={() => setSheet(myOption)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.ink }}>Add more</Text>
            </Pressable>
          ) : null}
        </View>
      ) : locked || settled ? (
        <Text style={[s.sub, { fontStyle: "italic" }]}>You skipped this one</Text>
      ) : (
        <View style={{ flexDirection: m.options.length === 2 ? "row" : "column", gap: 8 }}>
          {m.options.map((opt, i) => {
            const col = OPTION_COLORS[i % 4];
            return (
              <Pressable
                key={i}
                disabled={!ctx.token}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.selectionAsync();
                  setSheet(i);
                }}
                style={({ pressed }) => ({
                  flex: m.options.length === 2 ? 1 : undefined,
                  borderRadius: 14,
                  paddingVertical: 13,
                  paddingHorizontal: 14,
                  backgroundColor: col.bg,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: col.fg }}>{opt}</Text>
                <Text style={[{ fontFamily: F.mono, fontSize: 13, color: col.fg }, tnum]}>
                  pays {multipleText(m.pools, i, ctx.mult)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {sheet !== null ? <StakeSheet m={m} ctx={ctx} initial={sheet} lockSide={staked > 0} onClose={() => setSheet(null)} /> : null}
    </Card>
  );
}

const CHIPS = [50, 100, 250];

function StakeSheet({ m, ctx, initial, lockSide, onClose }: { m: Market; ctx: Ctx; initial: number; lockSide: boolean; onClose: () => void }) {
  const place = useMutation(api.game.placeStake);
  const [side, setSide] = useState(initial);
  const [text, setText] = useState(String(Math.min(100, ctx.points)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = Math.max(0, Math.min(ctx.points, Math.floor(Number(text) || 0)));
  const col = OPTION_COLORS[side % 4];
  const lead = m.pct.indexOf(Math.max(...m.pct));
  const bonus = Math.round((ctx.mult - 1) * 100);

  const confirm = async () => {
    if (!ctx.token || amount < 1) return;
    setBusy(true);
    setErr(null);
    try {
      await place({ token: ctx.token, betId: m._id, option: side, amount });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(30,28,25,0.35)" }} />
      <View
        style={{
          backgroundColor: C.card,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          padding: 20,
          paddingBottom: 34,
          gap: 14,
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
        }}
      >
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, alignSelf: "center" }} />
        <Text style={s.h2}>{m.question}</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Text style={[s.sub, tnum]}>
            <Text style={{ fontFamily: F.monoBold, color: C.ink }}>{Math.round(m.pct[lead])}%</Text> say {m.options[lead]} ·{" "}
            <Text style={{ fontFamily: F.mono, color: C.ink }}>{fmt(m.total)}</Text> pts in the pot
          </Text>
          <Sparkline ticks={m.ticks} start={ctx.roundStart} end={ctx.roundLock} now={ctx.now} width={90} height={30} color={OPTION_COLORS[lead % 4].fg} index={lead} />
        </View>
        <View style={{ flexDirection: m.options.length === 2 ? "row" : "column", gap: 8 }}>
          {m.options.map((o, i) => {
            const c = OPTION_COLORS[i % 4];
            const active = side === i;
            const disabled = lockSide && i !== initial;
            return (
              <Pressable
                key={i}
                disabled={disabled}
                onPress={() => setSide(i)}
                style={({ pressed }) => ({
                  flex: m.options.length === 2 ? 1 : undefined,
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  backgroundColor: active ? c.fg : c.bg,
                  opacity: disabled ? 0.35 : 1,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: active ? "#fff" : c.fg, textTransform: "uppercase" }}>{o}</Text>
                <Text style={[{ fontFamily: F.monoBold, fontSize: 16, color: active ? "#fff" : c.fg }, tnum]}>{Math.round(m.pct[i])}%</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.label}>How much?</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <TextInput
            value={text}
            onChangeText={(t) => setText(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            style={[
              {
                fontFamily: F.monoBold,
                fontSize: 24,
                color: C.ink,
                backgroundColor: C.paper,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 8,
                width: 84,
              },
              tnum,
            ]}
          />
          {CHIPS.map((c) => (
            <Chip key={c} label={String(c)} active={amount === c} disabled={c > ctx.points} onPress={() => setText(String(c))} />
          ))}
          <Chip label="All in" active={amount === ctx.points && ctx.points > 0} disabled={ctx.points <= 0} onPress={() => setText(String(ctx.points))} />
        </View>
        <View style={{ backgroundColor: col.bg, borderRadius: 14, padding: 14, gap: 4 }}>
          <Text style={[{ fontFamily: F.bodyMed, fontSize: 15, color: C.ink }, tnum]}>
            If {m.options[side]} wins you get ≈{" "}
            <TickingNumber value={payoutFor(m.pools, side, amount, ctx.mult)} style={{ fontFamily: F.monoBold, fontSize: 20, color: col.fg }} /> pts
          </Text>
          <Text style={s.sub}>
            Odds move as people bet. Streak bonus +{bonus}%.{ctx.late ? " This pick will be tagged late." : ""} You have {fmt(ctx.points)}.
          </Text>
        </View>
        {err ? <Text style={{ fontFamily: F.bodyMed, color: C.no, fontSize: 13 }}>{err}</Text> : null}
        <Pressable
          disabled={busy || amount < 1}
          onPress={confirm}
          style={({ pressed }) => ({
            backgroundColor: col.fg,
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: "center",
            opacity: busy || amount < 1 ? 0.5 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Text style={{ fontFamily: F.bodyBold, color: "#fff", fontSize: 17 }}>
            {busy ? "Placing…" : "Call it · " + fmt(amount) + " on " + m.options[side]}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Chip({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 10,
        paddingHorizontal: 13,
        borderRadius: 11,
        backgroundColor: active ? C.ink : C.card,
        borderWidth: 1.5,
        borderColor: active ? C.ink : C.line,
        opacity: disabled ? 0.35 : 1,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Text style={[{ fontFamily: F.mono, fontSize: 14, color: active ? "#fff" : C.ink }, tnum]}>{label}</Text>
    </Pressable>
  );
}
