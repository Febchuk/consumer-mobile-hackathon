import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { C, F, tnum } from "@/lib/theme";
import { clock, hourLabel } from "@/lib/time";
import { Button, Wordmark, s } from "./ui";

type Round = { _id: string; title: string; opensAt: number; locksAt: number };

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

export function DropLands({ round, count, now, onDone }: { round: Round; count: number; now: number; onDone: () => void }) {
  const onTimeLeft = round.opensAt + 10 * 60 * 1000 - now;
  const late = onTimeLeft <= 0;
  return (
    <View style={[s.screen, { justifyContent: "center", padding: 24, gap: 22 }]}>
      <View style={{ alignItems: "center" }}>
        <Wordmark size={24} />
      </View>
      <View style={{ alignItems: "center", gap: 10 }}>
        <Text style={[s.label, { fontSize: 13, color: C.flame }]}>
          {round.title} · {hourLabel(round.opensAt)}
        </Text>
        <Text style={[s.h1, { fontSize: 44, textAlign: "center", lineHeight: 50 }]}>Time to call it.</Text>
        <Text style={[s.body, { color: C.sub, textAlign: "center" }]}>
          {count} new {count === 1 ? "bet" : "bets"} just dropped for everyone
        </Text>
      </View>
      <View
        style={{
          alignSelf: "center",
          backgroundColor: late ? C.goldSoft : C.yesSoft,
          borderRadius: 22,
          paddingVertical: 18,
          paddingHorizontal: 28,
          alignItems: "center",
          gap: 4,
        }}
      >
        <Text style={[{ fontFamily: F.monoBold, fontSize: 64, color: late ? "#9A6B12" : C.yes, letterSpacing: -2 }, tnum]}>
          {late ? clock(round.locksAt - now) : clock(onTimeLeft)}
        </Text>
        <Text style={[s.sub, { color: late ? "#9A6B12" : C.yes, fontFamily: F.bodyBold }]}>
          {late ? "left before lock · picks now tagged LATE" : "left to bet on time · locks at " + hourLabel(round.locksAt)}
        </Text>
      </View>
      <Button label="See the bets" onPress={onDone} color={C.ink} style={{ alignSelf: "center", paddingHorizontal: 40 }} />
      <Text style={[s.sub, { textAlign: "center" }]}>After :10 your picks still count, but get tagged LATE.</Text>
    </View>
  );
}
