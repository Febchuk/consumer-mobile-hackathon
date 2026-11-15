import { useEffect, useRef, useState, ReactNode } from "react";
import { Pressable, Text, View, StyleSheet, ViewStyle, TextStyle, StyleProp } from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { Link, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, F, tnum } from "@/lib/theme";

const WORD = "CALLED IT";
const TILE_COLORS = [C.yes, C.gold, C.tile, C.yes, C.no, C.yes, null, C.gold, C.yes];

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: size * 0.1 }}>
      {WORD.split("").map((ch, i) =>
        ch === " " ? (
          <View key={i} style={{ width: size * 0.22 }} />
        ) : (
          <View
            key={i}
            style={{
              width: size,
              height: size * 1.08,
              borderRadius: size * 0.14,
              backgroundColor: TILE_COLORS[i] ?? C.tile,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: F.display,
                fontSize: size * 0.62,
                color: TILE_COLORS[i] === C.tile ? C.ink : "#fff",
                marginTop: -size * 0.04,
              }}
            >
              {ch}
            </Text>
          </View>
        ),
      )}
    </View>
  );
}

export function Flame({ n, size = 14, color }: { n: number; size?: number; color?: string }) {
  const lit = n > 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <Svg width={size * 0.8} height={size} viewBox="0 0 16 20">
        <Path
          d="M8 0c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z"
          fill={color ?? (lit ? C.flame : C.faint)}
        />
      </Svg>
      <Text style={[{ fontFamily: F.monoBold, fontSize: size * 0.95, color: lit ? C.flame : C.faint }, tnum]}>
        {n}
      </Text>
    </View>
  );
}

export function useTween(target: number, ms = 450) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const raf = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const start = Date.now();
    const a = from.current;
    if (raf.current) clearInterval(raf.current);
    raf.current = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (target - a) * e;
      from.current = v;
      setValue(v);
      if (k >= 1 && raf.current) clearInterval(raf.current);
    }, 16);
    return () => {
      if (raf.current) clearInterval(raf.current);
    };
  }, [target, ms]);
  return value;
}

export function TickingNumber({
  value,
  style,
  suffix = "",
  decimals = 0,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  suffix?: string;
  decimals?: number;
}) {
  const shown = useTween(value);
  const prev = useRef(value);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (Math.abs(value - prev.current) > 0.05) {
      setFlash(value > prev.current ? C.yes : C.no);
      const id = setTimeout(() => setFlash(null), 700);
      prev.current = value;
      return () => clearTimeout(id);
    }
  }, [value]);
  return (
    <Text style={[style, tnum, flash ? { color: flash } : null]}>
      {shown.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
      {suffix}
    </Text>
  );
}

type Tick = { t: number; pct: number[] };

function stepSeries(ticks: Tick[], index: number, n: number, start: number, until: number) {
  const sorted = [...ticks].sort((a, b) => a.t - b.t);
  let last = 100 / Math.max(1, n);
  const pts: [number, number][] = [[start, last]];
  for (const t of sorted) {
    if (t.t > until) break;
    const at = Math.max(t.t, start);
    pts.push([at, last]);
    last = t.pct[index] ?? last;
    pts.push([at, last]);
  }
  pts.push([until, last]);
  return pts;
}

export function Sparkline({
  ticks,
  start,
  end,
  now,
  width = 120,
  height = 44,
  color = C.yes,
  index = 0,
}: {
  ticks: Tick[];
  start: number;
  end: number;
  now: number;
  width?: number;
  height?: number;
  color?: string;
  index?: number;
}) {
  const span = Math.max(1, end - start);
  const n = ticks[0]?.pct.length ?? 2;
  const x = (t: number) => ((Math.min(Math.max(t, start), end) - start) / span) * (width - 6);
  const y = (p: number) => height - 4 - (p / 100) * (height - 8);
  const pts = stepSeries(ticks, index, n, start, Math.min(Math.max(now, start), end));
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Line x1={0} x2={width} y1={y(50)} y2={y(50)} stroke={C.line} strokeDasharray="3,4" strokeWidth={1} />
      <Polyline
        points={pts.map(([t, p]) => x(t) + "," + y(p)).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={x(last[0])} cy={y(last[1])} r={3.5} fill={color} />
    </Svg>
  );
}

export function MarketChart({
  ticks,
  start,
  end,
  now,
  colors,
  focus = 0,
  all = false,
  height = 120,
  axis = true,
  startLabel,
  endLabel,
  big = 1,
}: {
  ticks: Tick[];
  start: number;
  end: number;
  now: number;
  colors: string[];
  focus?: number;
  all?: boolean;
  height?: number;
  axis?: boolean;
  startLabel?: string;
  endLabel?: string;
  big?: number;
}) {
  const [width, setWidth] = useState(0);
  const n = colors.length;
  const axisW = axis ? 34 * big : 6;
  const foot = axis && (startLabel || endLabel) ? 20 * big : 6;
  const top = 8 * big;
  const plotW = Math.max(1, width - axisW);
  const plotH = Math.max(1, height - top - foot);
  const span = Math.max(1, end - start);
  const nowC = Math.min(Math.max(now, start), end);
  const x = (t: number) => ((Math.min(Math.max(t, start), end) - start) / span) * plotW;
  const y = (p: number) => top + plotH - (p / 100) * plotH;
  const series = colors.map((_, i) => stepSeries(ticks, i, n, start, nowC));
  const order = all ? colors.map((_, i) => i).filter((i) => i !== focus).concat(focus) : [focus];
  const path = (pts: [number, number][]) => pts.map(([t, p], i) => (i ? "L" : "M") + x(t).toFixed(1) + " " + y(p).toFixed(1)).join(" ");
  const fp = series[focus];
  const last = fp[fp.length - 1];
  const fc = colors[focus];
  const fs = 10 * big;
  return (
    <View style={{ height, width: "100%" }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {nowC < end ? <Rect x={x(nowC)} y={top} width={plotW - x(nowC)} height={plotH} fill={C.tile} opacity={0.45} /> : null}
          {[0, 25, 50, 75, 100].map((g) => (
            <Line
              key={g}
              x1={0}
              x2={plotW}
              y1={y(g)}
              y2={y(g)}
              stroke={g === 0 ? C.faint : C.line}
              strokeWidth={g === 0 ? 1.5 : 1}
              strokeDasharray={g === 0 || g === 100 ? undefined : "2,4"}
            />
          ))}
          {axis
            ? [25, 50, 75].map((g) => (
                <SvgText key={g} x={plotW + 6 * big} y={y(g) + fs * 0.35} fontSize={fs} fill={C.sub} fontFamily={F.mono}>
                  {g + "%"}
                </SvgText>
              ))
            : null}
          <Path d={path(fp) + " L" + x(last[0]).toFixed(1) + " " + y(0) + " L0 " + y(0) + " Z"} fill={fc} opacity={0.13} />
          {order.map((i) => (
            <Path
              key={i}
              d={path(series[i])}
              fill="none"
              stroke={colors[i]}
              strokeWidth={(i === focus ? 2.6 : 1.6) * big}
              strokeOpacity={i === focus ? 1 : 0.7}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {nowC < end ? <Line x1={x(nowC)} x2={x(nowC)} y1={top} y2={y(0)} stroke={C.faint} strokeWidth={1} strokeDasharray="2,3" /> : null}
          <Circle cx={x(last[0])} cy={y(last[1])} r={9 * big} fill={fc} opacity={0.18} />
          <Circle cx={x(last[0])} cy={y(last[1])} r={4.5 * big} fill={fc} stroke={C.card} strokeWidth={1.5 * big} />
          {axis && startLabel ? (
            <SvgText x={0} y={height - 5 * big} fontSize={fs} fill={C.sub} fontFamily={F.mono}>
              {startLabel}
            </SvgText>
          ) : null}
          {axis && endLabel ? (
            <SvgText x={plotW} y={height - 5 * big} fontSize={fs} fill={C.sub} fontFamily={F.mono} textAnchor="end">
              {endLabel}
            </SvgText>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

export function Faces({
  people,
  size = 24,
  max = 5,
  ring = C.card,
  bg = C.tile,
}: {
  people: { emoji: string }[];
  size?: number;
  max?: number;
  ring?: string;
  bg?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  if (!people.length) return null;
  const tile = (key: string | number, child: ReactNode, i: number, color = bg) => (
    <View
      key={key}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: Math.max(1.5, size / 14),
        borderColor: ring,
        marginLeft: i ? -size * 0.32 : 0,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20 - i,
      }}
    >
      {child}
    </View>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((p, i) => tile(i, <Text style={{ fontSize: size * 0.52, lineHeight: size * 0.7 }}>{p.emoji}</Text>, i))}
      {extra > 0
        ? tile(
            "x",
            <Text style={[{ fontFamily: F.monoBold, fontSize: size * 0.36, color: "#fff" }, tnum]}>+{extra}</Text>,
            shown.length,
            C.ink,
          )
        : null}
    </View>
  );
}

export function Delta({ value, size = 13, suffix }: { value: number; size?: number; suffix?: string }) {
  const r = Math.round(value);
  const color = r > 0 ? C.yes : r < 0 ? C.no : C.faint;
  return (
    <Text style={[{ fontFamily: F.monoBold, fontSize: size, color }, tnum]}>
      {r > 0 ? "▲ " : r < 0 ? "▼ " : "– "}
      {Math.abs(r)}
      {suffix ? <Text style={{ fontFamily: F.body, color: C.sub }}>{" " + suffix}</Text> : null}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Tag({ label, color = C.sub, bg = C.tile }: { label: string; color?: string; bg?: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color, letterSpacing: 1.1, textTransform: "uppercase" }}>
        {label}
      </Text>
    </View>
  );
}

export function LateTag() {
  return <Tag label="late" color={C.goldDeep} bg={C.goldSoft} />;
}

export function Button({
  label,
  onPress,
  color = C.ink,
  textColor = "#fff",
  disabled,
  style,
  small,
}: {
  label: string;
  onPress?: () => void;
  color?: string;
  textColor?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: color,
          borderRadius: 12,
          paddingVertical: small ? 8 : 15,
          paddingHorizontal: small ? 12 : 20,
          alignItems: "center",
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      <Text style={{ fontFamily: F.bodyBold, fontSize: small ? 13 : 16, color: textColor, letterSpacing: 0.2 }}>{label}</Text>
    </Pressable>
  );
}

export function BottomTabs() {
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const tabs = [
    { href: "/", label: "Today" },
    { href: "/board", label: "Board" },
    { href: "/me", label: "Me" },
  ] as const;
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: C.paper,
        borderTopWidth: 2,
        borderTopColor: C.ink,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 14),
        alignItems: "center",
      }}
    >
      <View style={{ flexDirection: "row", gap: 6, width: "100%", maxWidth: 420, paddingHorizontal: 16 }}>
        {tabs.map((t) => {
          const active = path === t.href;
          return (
            <Link key={t.href} href={t.href} asChild replace>
              <Pressable
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  alignItems: "center",
                  backgroundColor: active ? C.ink : "transparent",
                }}
              >
                <Text
                  style={{
                    fontFamily: F.bodyBold,
                    fontSize: 12.5,
                    letterSpacing: 1.4,
                    textTransform: "uppercase",
                    color: active ? C.paper : C.sub,
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </View>
  );
}

export const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.line,
    padding: 18,
  },
  h1: { fontFamily: F.display, fontSize: 36, color: C.ink, letterSpacing: -1, lineHeight: 40 },
  h2: { fontFamily: F.displaySemi, fontSize: 22, color: C.ink, lineHeight: 27, letterSpacing: -0.3 },
  body: { fontFamily: F.body, fontSize: 15, color: C.ink },
  sub: { fontFamily: F.body, fontSize: 13, color: C.sub },
  label: { fontFamily: F.bodyBold, fontSize: 11, color: C.sub, letterSpacing: 1.4, textTransform: "uppercase" },
  mono: { fontFamily: F.mono, color: C.ink },
  screen: { flex: 1, backgroundColor: C.paper },
  column: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: 18 },
  rule: { height: 2, backgroundColor: C.ink },
  hair: { height: 1, backgroundColor: C.line },
});
