import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";
import { C, F, tnum } from "@/lib/theme";
import { Button, Wordmark, s } from "@/components/ui";

type Friend = { name: string; emoji: string };

const DEFAULT_FRIENDS: Friend[] = [
  { name: "mikunad", emoji: "🦖" },
  { name: "febe", emoji: "👾" },
];

const PERMS = [
  { key: "photos", title: "Photos & screenshots", why: "Pick the group pics and chat screenshots to read", glyph: "◩", bg: C.blueSoft, fg: C.blue },
  { key: "chats", title: "Shared chats", why: "Share or export a chat in. We find the running jokes", glyph: "✉", bg: C.goldSoft, fg: C.goldDeep },
  { key: "contacts", title: "Contacts", why: "Finds friends who already play", glyph: "☺", bg: C.yesSoft, fg: C.yesDeep },
];

const FINDINGS = [
  "'thai thursdays' · 214 messages",
  "@jill · late 6 of the last 8 times",
  "Photos you picked · 38 photos of noodles",
  "@febe · 'omw' sent 41 times, arrived 9",
  "'karaoke' · mentioned 27 times this month",
  "@mikunad · screen time up 2h since Monday",
  "Group chat you shared · @jill texts first 71% of days",
];

const READ_MS = 4000;

function OnDevice({ style }: { style?: object }) {
  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: C.tile, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
        style,
      ]}
    >
      <Text style={{ fontSize: 12, color: C.ink2 }}>🔒︎</Text>
      <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2, letterSpacing: 0.2, flexShrink: 1 }}>Apple on-device model · only bet text leaves your phone</Text>
    </View>
  );
}

function PermCard({ p, on, onToggle }: { p: (typeof PERMS)[number]; on: boolean; onToggle: () => void }) {
  const pop = useRef(new Animated.Value(1)).current;
  const press = () => {
    onToggle();
    pop.setValue(0.92);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }).start();
  };
  return (
    <View
      style={[
        s.card,
        { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderColor: on ? C.yes : C.line, backgroundColor: on ? "#F4FAF5" : C.card },
      ]}
    >
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: p.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 22, color: p.fg, fontFamily: F.bodyBold }}>{p.glyph}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: F.displaySemi, fontSize: 18, color: C.ink }}>{p.title}</Text>
        <Text style={[s.sub, { lineHeight: 17 }]}>{p.why}</Text>
      </View>
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Pressable
          onPress={press}
          accessibilityRole="switch"
          accessibilityState={{ checked: on }}
          style={{
            paddingVertical: 9,
            paddingHorizontal: 13,
            borderRadius: 10,
            backgroundColor: on ? C.yes : C.paper,
            borderWidth: 1.5,
            borderColor: on ? C.yes : C.ink,
          }}
        >
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: on ? "#fff" : C.ink }}>{on ? "Allowed ✓" : "Allow"}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function Finding({ text }: { text: string }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a]);
  return (
    <Animated.View
      style={{
        opacity: a,
        transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: C.card,
        borderWidth: 1.5,
        borderColor: C.line,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold }} />
      <Text style={{ fontFamily: F.mono, fontSize: 12.5, color: C.ink, flex: 1 }}>{text}</Text>
    </Animated.View>
  );
}

export function ConnectContext({ onDone, friends = DEFAULT_FRIENDS }: { onDone: () => void; friends?: Friend[] }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(0);
  const [finished, setFinished] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const count = Object.values(allowed).filter(Boolean).length;

  useEffect(() => {
    if (step !== 2) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: READ_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start(({ finished: f }) => {
      if (f) setFinished(true);
    });
    const gap = (READ_MS - 400) / FINDINGS.length;
    const id = setInterval(() => setShown((n) => Math.min(FINDINGS.length, n + 1)), gap);
    return () => clearInterval(id);
  }, [step, progress]);

  const skip = (
    <Pressable onPress={onDone} hitSlop={12} style={{ alignSelf: "center", paddingVertical: 8 }}>
      <Text style={{ fontFamily: F.bodyMed, fontSize: 14, color: C.sub, textDecorationLine: "underline" }}>Skip for now</Text>
    </Pressable>
  );

  if (step === 1) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={[s.column, { paddingTop: 56, paddingBottom: 32, gap: 20 }]}>
        <Wordmark size={26} />
        <View style={{ gap: 8 }}>
          <Text style={s.h1}>Let Called It read the room.</Text>
          <Text style={[s.body, { color: C.sub, lineHeight: 22 }]}>
            Share a few chats and photos. Apple's on-device model drafts friendly roasts as bets. You pick which ones go out.
          </Text>
        </View>
        <OnDevice />
        <View style={{ gap: 10 }}>
          {PERMS.map((p) => (
            <PermCard key={p.key} p={p} on={!!allowed[p.key]} onToggle={() => setAllowed((a) => ({ ...a, [p.key]: !a[p.key] }))} />
          ))}
        </View>
        <View style={{ gap: 6, marginTop: 4 }}>
          <Button label={count ? "Continue" : "Allow at least one"} onPress={() => setStep(2)} disabled={count < 1} color={C.yes} />
          {skip}
        </View>
      </ScrollView>
    );
  }

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  const pct = Math.min(100, Math.round((shown / FINDINGS.length) * 100));
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.column, { paddingTop: 56, paddingBottom: 32, gap: 20 }]}>
      <Wordmark size={26} />
      <View style={{ gap: 8 }}>
        <Text style={s.h1}>{finished ? "All read." : "Reading what you shared, on your phone…"}</Text>
        <OnDevice />
      </View>
      {finished ? (
        <View style={[s.card, { backgroundColor: C.goldSoft, borderColor: C.gold, gap: 14 }]}>
          <Text style={s.label}>Result</Text>
          <Text style={[s.h2, { fontSize: 26, lineHeight: 31 }]}>
            Found {friends.length} friend{friends.length === 1 ? "" : "s"} · <Text style={tnum}>9</Text> bet ideas
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {friends.map((f) => (
              <View key={f.name} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.card, borderRadius: 999, paddingVertical: 6, paddingLeft: 8, paddingRight: 12 }}>
                <Text style={{ fontSize: 16 }}>{f.emoji}</Text>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.ink }}>@{f.name}</Text>
              </View>
            ))}
          </View>
          <Text style={s.sub}>Only the bet text leaves your phone. Some of it is going to be awkward.</Text>
          <Button label="See the bets" onPress={onDone} color={C.ink} />
        </View>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <View style={{ height: 12, borderRadius: 6, backgroundColor: C.tile, overflow: "hidden" }}>
              <Animated.View style={{ height: 12, width, backgroundColor: C.yes, borderRadius: 6 }} />
            </View>
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.sub, ...tnum }}>{pct}% · {shown} things noticed</Text>
          </View>
          <View style={{ gap: 8 }}>
            {FINDINGS.slice(0, shown).map((f) => (
              <Finding key={f} text={f} />
            ))}
          </View>
        </>
      )}
      {skip}
    </ScrollView>
  );
}
