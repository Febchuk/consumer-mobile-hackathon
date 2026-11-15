import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View } from "react-native";
import { I, t } from "./ios";

const DOTS = 90;

function Particles({ width, height }: { width: number; height: number }) {
  const phases = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = phases.map((p, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(p, { toValue: 1, duration: 900 + i * 350, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(p, { toValue: 0, duration: 900 + i * 350, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [phases]);
  const dots = useMemo(
    () =>
      Array.from({ length: DOTS }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1 + Math.random() * 1.8,
        g: i % 3,
        dx: (Math.random() - 0.5) * 8,
        dy: (Math.random() - 0.5) * 8,
        dark: Math.random() > 0.35,
      })),
    [width, height],
  );
  return (
    <>
      {dots.map((d, i) => {
        const p = phases[d.g];
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: d.x,
              top: d.y,
              width: d.r * 2,
              height: d.r * 2,
              borderRadius: d.r,
              backgroundColor: d.dark ? "#6E6E73" : "#FFFFFF",
              opacity: p.interpolate({ inputRange: [0, 1], outputRange: i % 2 ? [0.15, 0.95] : [0.9, 0.2] }),
              transform: [
                { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, d.dx] }) },
                { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, d.dy] }) },
              ],
            }}
          />
        );
      })}
    </>
  );
}

export function InvisibleInk({
  name,
  canRub,
  children,
  width = 250,
  height = 120,
  hint,
}: {
  name: string;
  canRub: boolean;
  children?: ReactNode;
  width?: number;
  height?: number;
  hint: string;
}) {
  const [gone, setGone] = useState(false);
  const [tip, setTip] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const moves = useRef(0);
  const uncover = () => {
    Animated.timing(fade, { toValue: 0, duration: 700, useNativeDriver: true }).start(() => setGone(true));
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          if (!canRub) setTip(true);
        },
        onPanResponderMove: () => {
          if (!canRub) return;
          moves.current += 1;
          fade.setValue(Math.max(0.15, 1 - moves.current / 30));
          if (moves.current > 24) uncover();
        },
        onPanResponderRelease: () => {
          if (canRub && moves.current <= 24) Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start(() => (moves.current = 0));
          setTimeout(() => setTip(false), 1600);
        },
      }),
    [canRub, fade],
  );
  if (gone && children) return <>{children}</>;
  return (
    <View>
      {children ? <View style={{ opacity: 0 }}>{children}</View> : <View style={{ width, height }} />}
      <Animated.View
        {...pan.panHandlers}
        style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: 18, overflow: "hidden", backgroundColor: I.ink, opacity: fade, alignItems: "center", justifyContent: "center" }}
      >
        <Particles width={width} height={height} />
        <View style={{ backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={t(15, "600")}>{name}</Text>
        </View>
      </Animated.View>
      {tip || canRub || hint ? (
        <Pressable onLongPress={canRub ? uncover : undefined}>
          <Text style={[t(11, "500", I.secondary), { marginTop: 4, marginLeft: 4 }]}>{canRub ? "Rub to reveal" : hint}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
