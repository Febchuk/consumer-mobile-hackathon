import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { C, F, tnum } from "@/lib/theme";
import { clock, hourLabel } from "@/lib/time";
import { s } from "./ui";

type Round = { _id: string; title: string; opensAt: number };

export function useDropSeen(roundId: string | undefined) {
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem("calledit.seenDrop").then(setSeen);
  }, []);
  const markSeen = () => {
    if (!roundId) return;
    setSeen(roundId);
    AsyncStorage.setItem("calledit.seenDrop", roundId);
  };
  return { show: seen !== undefined && !!roundId && seen !== roundId, markSeen };
}

const TILES = [C.yes, C.gold, C.no, C.yes, C.blue, C.gold, C.yes, C.no];

export function DropLands({ round, count, now, onDone }: { round: Round; count: number; now: number; onDone: () => void }) {
  const nextAt = round.opensAt + 60 * 60 * 1000;
  const onTimeLeft = round.opensAt + 10 * 60 * 1000 - now;
  const late = onTimeLeft <= 0;
  const bg = late ? C.gold : C.yes;
  return (
    <View style={{ flex: 1, backgroundColor: bg, justifyContent: "center", padding: 28, gap: 26 }}>
      <View style={{ gap: 12 }}>
        <Text style={[s.label, { fontSize: 13, color: C.ink }]}>
          {round.title} · {hourLabel(round.opensAt)}
        </Text>
        <Text style={{ fontFamily: F.display, fontSize: 64, lineHeight: 62, letterSpacing: -2.5, color: "#fff" }}>Time to{"\n"}call it.</Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {Array.from({ length: Math.max(1, count) }, (_, i) => (
            <View key={i} style={{ width: 38, height: 42, borderRadius: 6, backgroundColor: i % 2 ? C.ink : C.paper, alignItems: "center", justifyContent: "center" }}>
              <Text style={[{ fontFamily: F.monoBold, fontSize: 18, color: i % 2 ? C.paper : TILES[i % TILES.length] === bg ? C.ink : TILES[i % TILES.length] }, tnum]}>{i + 1}</Text>
            </View>
          ))}
        </View>
        <Text style={[s.body, { color: C.ink, fontFamily: F.bodyMed, fontSize: 17 }]}>
          {count} new {count === 1 ? "bet" : "bets"} just dropped for everyone.
        </Text>
      </View>
      <View style={{ borderTopWidth: 2, borderTopColor: C.ink, paddingTop: 14, gap: 2 }}>
        <Text style={[{ fontFamily: F.monoBold, fontSize: 72, lineHeight: 76, color: C.ink, letterSpacing: -3 }, tnum]}>
          {late ? clock(Math.max(0, nextAt - now)) : clock(onTimeLeft)}
        </Text>
        <Text style={[s.label, { color: C.ink }]}>{late ? "until the next drop · picks now tagged late" : "left to call it on time"}</Text>
      </View>
      <Pressable
        onPress={onDone}
        style={({ pressed }) => ({ backgroundColor: C.ink, borderRadius: 12, paddingVertical: 17, alignItems: "center", transform: [{ scale: pressed ? 0.97 : 1 }] })}
      >
        <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.paper, letterSpacing: 1.2 }}>SEE THE BETS →</Text>
      </Pressable>
      <Text style={[s.sub, { color: C.ink, opacity: 0.75 }]}>Bets stay open until the next drop. After :10 your picks still count, but get tagged late.</Text>
    </View>
  );
}
