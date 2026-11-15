import { useState } from "react";
import { Pressable, Text, View, Platform } from "react-native";
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

const CHIPS = [25, 50, 100, 250];

function errorText(e: unknown) {
  const msg = (e as { data?: string; message?: string })?.data ?? (e as Error)?.message ?? "Something went wrong";
  return typeof msg === "string" ? msg.replace(/^.*Uncaught ConvexError: /, "").split("\n")[0] : "Something went wrong";
}

export function MarketCard({
  m,
  token,
  points,
  mult,
  roundStart,
  roundLock,
  now,
  late,
}: {
  m: Market;
  token: string | null;
  points: number;
  mult: number;
  roundStart: number;
  roundLock: number;
  now: number;
  late: boolean;
}) {
  const place = useMutation(api.game.placeStake);
  const [pick, setPick] = useState<number | null>(null);
  const [stake, setStake] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const locked = m.locked || now >= roundLock;
  const settled = m.status === "settled" || m.status === "refunded";
  const lead = m.options.length === 2 ? 0 : m.pct.indexOf(Math.max(...m.pct));
  const leadColor = OPTION_COLORS[lead % 4].fg;
  const amount = Math.min(stake, points);

  const confirm = async () => {
    if (pick === null || !token) return;
    setBusy(true);
    setErr(null);
    try {
      await place({ token, betId: m._id, option: pick, amount });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPick(null);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = m.kind === "yesno" ? "Yes / No" : m.kind === "overunder" ? "Over / Under" : "Pick one";

  return (
    <Card style={{ gap: 14 }}>
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
          <Text style={[s.label, { marginTop: 2 }]}>chance {m.options[lead]}</Text>
        </View>
        <Sparkline ticks={m.ticks} start={roundStart} end={roundLock} now={now} color={leadColor} />
      </View>

      <View style={{ flexDirection: m.options.length === 2 ? "row" : "column", gap: 8 }}>
        {m.options.map((opt, i) => {
          const col = OPTION_COLORS[i % 4];
          const won = settled && m.winningOption === i;
          const selected = pick === i;
          const pays = payoutFor(m.pools, i, amount, mult);
          return (
            <Pressable
              key={i}
              disabled={locked || settled || !token}
              onPress={() => {
                setErr(null);
                setPick(selected ? null : i);
                if (Platform.OS !== "web") Haptics.selectionAsync();
              }}
              style={({ pressed }) => ({
                flex: m.options.length === 2 ? 1 : undefined,
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 14,
                backgroundColor: selected || won ? col.fg : col.bg,
                borderWidth: 2,
                borderColor: selected || won ? col.fg : "transparent",
                opacity: (locked || settled) && !won ? 0.55 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: selected || won ? "#fff" : col.fg }}>
                  {won ? "✓ " : ""}
                  {opt}
                </Text>
                <Text style={[{ fontFamily: F.monoBold, fontSize: 16, color: selected || won ? "#fff" : col.fg }, tnum]}>
                  {Math.round(m.pct[i])}%
                </Text>
              </View>
              {!settled && !locked ? (
                <Text style={[{ fontFamily: F.mono, fontSize: 12, marginTop: 3, color: selected ? "#ffffffd0" : C.sub }, tnum]}>
                  {fmt(amount)} pays {fmt(pays)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {pick !== null && !locked ? (
        <View style={{ gap: 10, backgroundColor: C.paper, borderRadius: 14, padding: 12 }}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {CHIPS.map((c) => (
              <Chip key={c} label={String(c)} active={stake === c} disabled={c > points} onPress={() => setStake(c)} />
            ))}
            <Chip label="All in" active={stake === points} disabled={points <= 0} onPress={() => setStake(points)} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Stepper label="−" onPress={() => setStake(Math.max(5, stake - 10))} />
            <Text style={[{ fontFamily: F.monoBold, fontSize: 22, color: C.ink, minWidth: 64, textAlign: "center" }, tnum]}>
              {fmt(amount)}
            </Text>
            <Stepper label="+" onPress={() => setStake(Math.min(points, stake + 10))} />
            <View style={{ flex: 1 }} />
            <Pressable
              disabled={busy || amount < 1}
              onPress={confirm}
              style={({ pressed }) => ({
                backgroundColor: OPTION_COLORS[pick % 4].fg,
                borderRadius: 12,
                paddingVertical: 11,
                paddingHorizontal: 16,
                opacity: busy || amount < 1 ? 0.5 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <Text style={{ fontFamily: F.bodyBold, color: "#fff", fontSize: 15 }}>
                {busy ? "Placing…" : "Call it: " + m.options[pick]}
              </Text>
            </Pressable>
          </View>
          <Text style={[s.sub, tnum]}>
            Wins {fmt(payoutFor(m.pools, pick, amount, mult))} if {m.options[pick]}
            {mult > 1 ? " (incl. ×" + mult.toFixed(1) + " streak)" : ""}
            {late ? " · this pick will be tagged late" : ""}
          </Text>
        </View>
      ) : null}

      {err ? <Text style={{ fontFamily: F.bodyMed, color: C.no, fontSize: 13 }}>{err}</Text> : null}

      {m.mine.length > 0 ? (
        <View style={{ borderTopWidth: 1.5, borderTopColor: C.line, paddingTop: 10, gap: 6 }}>
          {m.mine.map((p, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.body, tnum, { fontFamily: F.bodyMed }]}>
                You: <Text style={{ fontFamily: F.mono }}>{fmt(p.amount)}</Text> on {m.options[p.option]}
              </Text>
              {p.late ? <LateTag /> : null}
              <View style={{ flex: 1 }} />
              {p.payout !== undefined ? (
                <Text style={[{ fontFamily: F.monoBold, color: p.payout > 0 ? C.yes : C.no }, tnum]}>
                  {p.payout > 0 ? "+" + fmt(p.payout) : "−" + fmt(p.amount)}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Chip({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 10,
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

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: C.card,
        borderWidth: 1.5,
        borderColor: C.line,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.9 : 1 }],
      })}
    >
      <Text style={{ fontFamily: F.monoBold, fontSize: 18, color: C.ink }}>{label}</Text>
    </Pressable>
  );
}
