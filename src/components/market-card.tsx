import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View, Platform } from "react-native";
import { useMutation, useQueries } from "convex/react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { C, F, OPTION_COLORS, tnum } from "@/lib/theme";
import { payoutFor } from "@/lib/odds";
import { fmt, hourLabel } from "@/lib/time";
import { Delta, Faces, LateTag, MarketChart, Tag, TickingNumber, s } from "./ui";

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
  subject?: { name: string; emoji: string } | null;
  ticks: { t: number; pct: number[] }[];
  mine: { option: number; amount: number; late: boolean; payout?: number }[];
};

export type Staker = { id: string; emoji: string; name: string; amount: number; late: boolean; payout?: number; me: boolean };

export type Ctx = { token: string | null; points: number; mult: number; roundStart: number; roundLock: number; now: number; late: boolean };

export function usePeople(betId: Id<"bets">, token: string | null) {
  const res = useQueries({ people: { query: api.market.people, args: token ? { betId, token } : { betId } } }).people as
    | { sides: Staker[][] }
    | null
    | undefined
    | Error;
  return res instanceof Error || !res ? undefined : res.sides;
}

export function leadOf(m: Pick<Market, "status" | "winningOption" | "pct">) {
  return m.status === "settled" && m.winningOption !== undefined ? m.winningOption : m.pct.indexOf(Math.max(...m.pct));
}

export function sinceDrop(m: Pick<Market, "pct" | "options">, i: number) {
  return m.pct[i] - 100 / m.options.length;
}

export function kindLabel(kind: Market["kind"]) {
  return kind === "yesno" ? "Yes / No" : kind === "overunder" ? "Over / Under" : "Pick one";
}

export function errorText(e: unknown) {
  const msg = (e as { data?: string })?.data ?? (e as Error)?.message ?? "Something went wrong";
  return typeof msg === "string" ? msg.replace(/^.*ConvexError: /, "").split("\n")[0] : "Something went wrong";
}

export function multipleText(pools: number[], i: number, mult: number) {
  const x = payoutFor(pools, i, 100, mult) / 100;
  return x.toFixed(x >= 10 ? 0 : 1) + "x";
}

export function myPosition(m: Market) {
  const staked = m.mine.reduce((a, p) => a + p.amount, 0);
  const option = m.mine[0]?.option;
  const late = m.mine.some((p) => p.late);
  const payout = m.mine.length && m.mine.every((p) => p.payout !== undefined) ? m.mine.reduce((a, p) => a + (p.payout ?? 0), 0) : undefined;
  return { staked, option, late, payout };
}

export function SubjectLine({ subject }: { subject?: { name: string; emoji: string } | null }) {
  if (!subject) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: -4 }}>
      <Text style={{ fontSize: 15 }}>{subject.emoji}</Text>
      <Text style={[s.label, { color: C.blue }]}>about @{subject.name}</Text>
    </View>
  );
}

export function StatusTag({ m }: { m: Pick<Market, "status" | "locked"> }) {
  if (m.status === "settled") return <Tag label="called" color="#fff" bg={C.ink} />;
  if (m.status === "refunded") return <Tag label="void" color="#fff" bg={C.sub} />;
  if (m.locked) return <Tag label="closed · awaiting result" color={C.goldDeep} bg={C.goldSoft} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.live }} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 1.1, color: C.live }}>LIVE</Text>
    </View>
  );
}

export function MarketCard({ m, ctx }: { m: Market; ctx: Ctx }) {
  const [sheet, setSheet] = useState<number | null>(null);
  const sides = usePeople(m._id, ctx.token);
  const settled = m.status === "settled" || m.status === "refunded";
  const closed = m.locked || settled;
  const lead = leadOf(m);
  const leadColor = m.locked && !settled ? C.ink2 : OPTION_COLORS[lead % 4].fg;
  const pos = myPosition(m);
  const binary = m.options.length === 2;
  const open = () => router.push({ pathname: "/bet/[id]", params: { id: m._id } });

  return (
    <View style={{ borderTopWidth: 2, borderTopColor: C.ink, paddingTop: 12, paddingBottom: 10, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={s.label}>{kindLabel(m.kind)}</Text>
        <StatusTag m={m} />
        <View style={{ flex: 1 }} />
        <Text style={[{ fontFamily: F.mono, fontSize: 12, color: C.sub }, tnum]}>
          {fmt(m.total)} pts · {m.bettors} in
        </Text>
      </View>

      <Pressable onPress={open} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, gap: 10 })}>
        <SubjectLine subject={m.subject} />
        <Text style={[s.h2, { fontSize: 23, lineHeight: 28 }]}>{m.question}</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          {settled ? (
            <Text
              numberOfLines={1}
              style={{ fontFamily: F.display, fontSize: 46, lineHeight: 50, color: m.status === "refunded" ? C.sub : leadColor, textTransform: "uppercase", letterSpacing: -1 }}
            >
              {m.status === "refunded" ? "Void" : m.options[lead]}
            </Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <TickingNumber value={m.pct[lead]} style={{ fontFamily: F.monoBold, fontSize: 52, color: leadColor, letterSpacing: -2.5, lineHeight: 54 }} />
              <Text style={{ fontFamily: F.monoBold, fontSize: 20, color: leadColor, marginTop: 5 }}>%</Text>
            </View>
          )}
          <View style={{ paddingBottom: 6, gap: 2, flex: 1 }}>
            <Text numberOfLines={1} style={[s.label, { color: C.ink }]}>
              {settled ? (m.status === "refunded" ? "points refunded" : "the result") : m.options[lead] + " chance"}
            </Text>
            {settled ? (
              <Text style={[s.sub, tnum]}>{m.status === "refunded" ? "nobody called it" : Math.round(m.pct[lead]) + "% called it"}</Text>
            ) : (
              <Delta value={sinceDrop(m, lead)} suffix="since drop" size={12} />
            )}
          </View>
        </View>
        <MarketChart
          ticks={m.ticks}
          start={ctx.roundStart}
          end={ctx.roundLock}
          now={ctx.now}
          colors={m.options.map((_, i) => OPTION_COLORS[i % 4].fg)}
          focus={lead}
          all={!binary}
          height={96}
          startLabel={hourLabel(ctx.roundStart)}
          endLabel={"next drop " + hourLabel(ctx.roundLock)}
        />
      </Pressable>

      <View style={{ flexDirection: binary ? "row" : "column", gap: 8 }}>
        {m.options.map((opt, i) => {
          const col = OPTION_COLORS[i % 4];
          const won = m.status === "settled" && m.winningOption === i;
          const lost = m.status === "settled" && m.winningOption !== i;
          const disabled = !ctx.token || closed || (pos.staked > 0 && i !== pos.option);
          const people = sides?.[i] ?? [];
          return (
            <Pressable
              key={i}
              disabled={disabled}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                setSheet(i);
              }}
              style={({ pressed }) => ({
                flex: binary ? 1 : undefined,
                borderRadius: 12,
                paddingVertical: 11,
                paddingHorizontal: 12,
                gap: 8,
                backgroundColor: won ? col.fg : col.bg,
                opacity: lost ? 0.45 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, letterSpacing: 0.6, color: won ? "#fff" : col.deep, textTransform: "uppercase", flexShrink: 1 }}>
                  {won ? "✓ " : ""}
                  {opt}
                </Text>
                <Text style={[{ fontFamily: F.monoBold, fontSize: 17, color: won ? "#fff" : col.deep }, tnum]}>{Math.round(m.pct[i])}%</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 22, gap: 6 }}>
                {people.length ? (
                  <Faces people={people} size={22} max={4} ring={won ? col.fg : col.bg} bg={C.card} />
                ) : (
                  <Text style={[s.sub, { fontSize: 12, color: won ? "#fff" : col.deep, opacity: 0.7 }]}>{closed ? "nobody" : "be first"}</Text>
                )}
                <Text style={[{ fontFamily: F.mono, fontSize: 12, color: won ? "#fff" : col.deep }, tnum]}>
                  {closed ? people.length + " in" : "pays " + multipleText(m.pools, i, ctx.mult)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <PositionBand m={m} mult={ctx.mult} onAdd={pos.staked > 0 && !closed ? () => setSheet(pos.option) : undefined} />

      {sheet !== null ? <StakeSheet m={m} ctx={ctx} initial={sheet} lockSide={pos.staked > 0} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

export function PositionBand({ m, mult, onAdd }: { m: Market; mult: number; onAdd?: () => void }) {
  const pos = myPosition(m);
  const settled = m.status === "settled" || m.status === "refunded";
  if (pos.staked === 0) {
    return m.locked || settled ? <Text style={[s.sub, { fontStyle: "italic" }]}>You sat this one out.</Text> : null;
  }
  const col = OPTION_COLORS[pos.option % 4];
  const net = pos.payout === undefined ? undefined : pos.payout - pos.staked;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, borderLeftWidth: 4, borderLeftColor: col.fg, paddingLeft: 10, paddingVertical: 2 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: C.ink }, tnum]}>
            You called <Text style={{ color: col.fg }}>{m.options[pos.option].toUpperCase()}</Text> ·{" "}
            <Text style={{ fontFamily: F.monoBold }}>{fmt(pos.staked)}</Text>
          </Text>
          {pos.late ? <LateTag /> : null}
        </View>
        {pos.payout === undefined ? (
          <Text style={[s.sub, tnum, { fontFamily: F.mono, fontSize: 12 }]}>
            wins {fmt(payoutFor(m.pools.map((p, i) => (i === pos.option ? p - pos.staked : p)), pos.option, pos.staked, mult))} if it lands
          </Text>
        ) : null}
      </View>
      {net !== undefined ? (
        <Text style={[{ fontFamily: F.monoBold, fontSize: 20, color: m.status === "refunded" ? C.sub : net >= 0 ? C.yes : C.no }, tnum]}>
          {m.status === "refunded" ? "refund" : (net >= 0 ? "+" : "−") + fmt(Math.abs(net))}
        </Text>
      ) : onAdd ? (
        <Pressable onPress={onAdd} style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: C.ink, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 0.8, color: C.ink }}>ADD MORE</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const CHIPS = [50, 100, 250];

export function StakePanel({
  m,
  ctx,
  initial,
  lockSide,
  onDone,
}: {
  m: Market;
  ctx: Ctx;
  initial: number;
  lockSide: boolean;
  onDone?: () => void;
}) {
  const place = useMutation(api.game.placeStake);
  const [side, setSide] = useState(initial);
  const [text, setText] = useState(String(Math.min(100, ctx.points)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = Math.max(0, Math.min(ctx.points, Math.floor(Number(text) || 0)));
  const col = OPTION_COLORS[side % 4];
  const bonus = Math.round((ctx.mult - 1) * 100);
  const binary = m.options.length === 2;

  const confirm = async () => {
    if (!ctx.token || amount < 1) return;
    setBusy(true);
    setErr(null);
    try {
      await place({ token: ctx.token, betId: m._id, option: side, amount });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone?.();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: binary ? "row" : "column", gap: 8 }}>
        {m.options.map((o, i) => {
          const c = OPTION_COLORS[i % 4];
          const active = side === i;
          const disabled = lockSide && i !== initial;
          return (
            <Pressable
              key={i}
              disabled={disabled}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                setSide(i);
              }}
              style={({ pressed }) => ({
                flex: binary ? 1 : undefined,
                paddingVertical: 13,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: active ? c.fg : c.bg,
                opacity: disabled ? 0.3 : 1,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "baseline",
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 16, letterSpacing: 0.6, color: active ? "#fff" : c.deep, textTransform: "uppercase", flexShrink: 1 }}>
                {o}
              </Text>
              <Text style={[{ fontFamily: F.monoBold, fontSize: 15, color: active ? "#fff" : c.deep }, tnum]}>{multipleText(m.pools, i, ctx.mult)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <TextInput
          value={text}
          onChangeText={(t) => setText(t.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          style={[
            {
              fontFamily: F.monoBold,
              fontSize: 22,
              color: C.ink,
              backgroundColor: C.paper,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: C.ink,
              paddingHorizontal: 10,
              paddingVertical: 6,
              width: 86,
            },
            tnum,
          ]}
        />
        {CHIPS.map((c) => (
          <Chip key={c} label={String(c)} active={amount === c} disabled={c > ctx.points} onPress={() => setText(String(c))} />
        ))}
        <Chip label="ALL IN" active={amount === ctx.points && ctx.points > 0} disabled={ctx.points <= 0} onPress={() => setText(String(ctx.points))} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", backgroundColor: col.bg, borderRadius: 10, padding: 12, gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.label, { color: col.deep }]}>If {m.options[side]} lands</Text>
          <Text style={[s.sub, { fontSize: 12 }]}>
            Odds move as people bet{bonus > 0 ? " · streak +" + bonus + "%" : ""}
            {ctx.late ? " · tagged late" : ""} · you have {fmt(ctx.points)}
          </Text>
        </View>
        <TickingNumber value={payoutFor(m.pools, side, amount, ctx.mult)} style={{ fontFamily: F.monoBold, fontSize: 28, color: col.deep, letterSpacing: -1 }} />
      </View>
      {err ? <Text style={{ fontFamily: F.bodyMed, color: C.no, fontSize: 13 }}>{err}</Text> : null}
      <Pressable
        disabled={busy || amount < 1 || !ctx.token}
        onPress={confirm}
        style={({ pressed }) => ({
          backgroundColor: C.ink,
          borderRadius: 12,
          paddingVertical: 16,
          alignItems: "center",
          opacity: busy || amount < 1 || !ctx.token ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
      >
        <Text style={[{ fontFamily: F.bodyBold, color: "#fff", fontSize: 16, letterSpacing: 0.3 }, tnum]}>
          {busy ? "Placing…" : "Call it · " + fmt(amount) + " on " + m.options[side]}
        </Text>
      </Pressable>
    </View>
  );
}

export function StakeSheet({ m, ctx, initial, lockSide, onClose }: { m: Market; ctx: Ctx; initial: number; lockSide: boolean; onClose: () => void }) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(30,28,25,0.35)" }} />
      <View
        style={{
          backgroundColor: C.card,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderTopWidth: 2,
          borderColor: C.ink,
          padding: 20,
          paddingBottom: 34,
          gap: 14,
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
        }}
      >
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: "center" }} />
        <Text style={s.h2}>{m.question}</Text>
        <StakePanel m={m} ctx={ctx} initial={initial} lockSide={lockSide} onDone={onClose} />
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
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: active ? C.ink : C.card,
        borderWidth: 1.5,
        borderColor: active ? C.ink : C.line,
        opacity: disabled ? 0.35 : 1,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Text style={[{ fontFamily: F.mono, fontSize: 13, color: active ? "#fff" : C.ink }, tnum]}>{label}</Text>
    </Pressable>
  );
}
