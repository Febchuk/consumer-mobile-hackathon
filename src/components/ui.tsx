import { useEffect, useRef, useState, ReactNode } from "react";
import { Pressable, Text, View, StyleSheet, ViewStyle, TextStyle, StyleProp } from "react-native";
import Svg, { Path, Polyline, Line } from "react-native-svg";
import { Link, usePathname } from "expo-router";
import { C, F, tnum } from "@/lib/theme";

const WORD = "CALLED IT";
const TILE_COLORS = [C.yes, C.gold, C.tile, C.yes, C.no, C.yes, null, C.gold, C.yes];

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: size * 0.12 }}>
      {WORD.split("").map((ch, i) =>
        ch === " " ? (
          <View key={i} style={{ width: size * 0.25 }} />
        ) : (
          <View
            key={i}
            style={{
              width: size,
              height: size * 1.08,
              borderRadius: size * 0.22,
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

export function Sparkline({
  ticks,
  start,
  end,
  now,
  width = 120,
  height = 44,
  color = C.yes,
}: {
  ticks: { t: number; pct: number[] }[];
  start: number;
  end: number;
  now: number;
  width?: number;
  height?: number;
  color?: string;
}) {
  const span = Math.max(1, end - start);
  const x = (t: number) => (Math.min(Math.max(t, start), end) - start) / span * width;
  const y = (p: number) => height - 3 - (p / 100) * (height - 6);
  const pts: string[] = [];
  let last = 50;
  const sorted = [...ticks].sort((a, b) => a.t - b.t);
  if (sorted.length) last = sorted[0].pct[0];
  pts.push(x(start) + "," + y(last));
  for (const t of sorted) {
    pts.push(x(t.t) + "," + y(last));
    last = t.pct[0];
    pts.push(x(t.t) + "," + y(last));
  }
  pts.push(x(Math.min(now, end)) + "," + y(last));
  return (
    <Svg width={width} height={height}>
      <Line x1={0} x2={width} y1={y(50)} y2={y(50)} stroke={C.line} strokeDasharray="3,4" strokeWidth={1} />
      <Polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Tag({ label, color = C.sub, bg = C.tile }: { label: string; color?: string; bg?: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color, letterSpacing: 0.6, textTransform: "uppercase" }}>
        {label}
      </Text>
    </View>
  );
}

export function LateTag() {
  return <Tag label="late" color="#9A6B12" bg={C.goldSoft} />;
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
          borderRadius: 14,
          paddingVertical: small ? 8 : 14,
          paddingHorizontal: small ? 12 : 18,
          alignItems: "center",
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      <Text style={{ fontFamily: F.bodyBold, fontSize: small ? 13 : 16, color: textColor }}>{label}</Text>
    </Pressable>
  );
}

export function NavTabs() {
  const path = usePathname();
  const tabs = [
    { href: "/", label: "Today" },
    { href: "/board", label: "Board" },
  ] as const;
  return (
    <View style={{ flexDirection: "row", backgroundColor: C.tile, borderRadius: 12, padding: 3 }}>
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link key={t.href} href={t.href} asChild>
            <Pressable
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 9,
                backgroundColor: active ? C.card : "transparent",
              }}
            >
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: active ? C.ink : C.sub }}>{t.label}</Text>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

export const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.line,
    padding: 18,
  },
  h1: { fontFamily: F.display, fontSize: 30, color: C.ink, letterSpacing: -0.5 },
  h2: { fontFamily: F.displaySemi, fontSize: 21, color: C.ink, lineHeight: 26 },
  body: { fontFamily: F.body, fontSize: 15, color: C.ink },
  sub: { fontFamily: F.body, fontSize: 13, color: C.sub },
  label: { fontFamily: F.bodyBold, fontSize: 11, color: C.sub, letterSpacing: 1, textTransform: "uppercase" },
  mono: { fontFamily: F.mono, color: C.ink },
  screen: { flex: 1, backgroundColor: C.paper },
  column: { width: "100%", maxWidth: 520, alignSelf: "center", paddingHorizontal: 16 },
});
