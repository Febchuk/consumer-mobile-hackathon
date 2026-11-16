import { Pressable, Text, View } from "react-native";
import { C, F } from "@/lib/theme";
import { s } from "@/components/ui";

export type Draft = { subjectId: string; kind: "yesno" | "overunder" | "multi"; question: string; line?: number; options?: string[] };

type Member = { _id: string; name: string; emoji: string };
type Idea = { kind: Draft["kind"]; q: string; why: string; line?: number; options?: string[] };

const JILL: Idea[] = [
  { kind: "multi", q: "What does @jill order at Thai Thursday?", why: "14 messages in the 'thai thursdays' chat you shared", options: ["Drunken noodle", "Pad see ew"] },
  { kind: "yesno", q: "Does @jill text first in the group tomorrow?", why: "Opens 71% of days in the group chat you shared" },
  { kind: "overunder", q: "Boba runs by @jill this week", why: "'boba?' sent 9 times in the 'weekend plans' chat you shared", line: 2.5 },
  { kind: "yesno", q: "Is @jill late to the next group dinner?", why: "6 of 8 group photos you picked" },
  { kind: "overunder", q: "Minutes late: @jill to Friday plans", why: "'omw' to arrival gap: 22 min in the chat you shared", line: 2.5 },
];
const FEBE: Idea[] = [
  { kind: "overunder", q: "Hours of screen time for @febe today", why: "Screenshot you picked shows 2.4 hrs/day", line: 2.5 },
  { kind: "multi", q: "Who does @febe text first tomorrow?", why: "Top two first-texts in the chat you shared", options: ["Jill", "Mikun"] },
  { kind: "multi", q: "@febe's karaoke pick?", why: "Both songs came up in the 'karaoke night' chat you shared", options: ["Mr. Brightside", "Dancing Queen"] },
  { kind: "overunder", q: "Phone pickups for @febe before noon", why: "'I only checked once' x6 in a chat you shared", line: 2.5 },
  { kind: "yesno", q: "Does @febe say 'omw' while still at home?", why: "'omw' sent 41 times in the chat you shared, arrived 9" },
];
const MIKUN: Idea[] = [
  { kind: "yesno", q: "Does @mikunad hit the gym 3 days in a row?", why: "Gym streak mentioned 11 times in a chat you shared" },
  { kind: "overunder", q: "Karaoke songs @mikunad sings this month", why: "27 'karaoke' mentions in the chats you shared", line: 2.5 },
  { kind: "multi", q: "@mikunad's karaoke opener?", why: "Both picks came up in the 'karaoke night' chat you shared", options: ["Mr. Brightside", "Dancing Queen"] },
  { kind: "yesno", q: "Does @mikunad keep the gym streak to 5 days?", why: "Gym streak mentioned 11 times in a chat you shared" },
  { kind: "overunder", q: "Group texts @mikunad sends before 9am", why: "Fastest replies before coffee in 3 chats you shared", line: 2.5 },
];
const GENERIC: Idea[] = [
  { kind: "yesno", q: "Does @NAME text first tomorrow?", why: "Texted first on 4 of 7 days in the chat you shared" },
  { kind: "overunder", q: "Hours of screen time for @NAME today", why: "Screenshot you picked shows 2.4 hrs", line: 2.5 },
  { kind: "multi", q: "Where does @NAME eat next?", why: "Two spots keep coming up in the chat you shared", options: ["Tacos", "Noodles"] },
];

function ideasFor(name: string): Idea[] {
  const n = name.toLowerCase();
  if (n.startsWith("jill")) return JILL;
  if (n.startsWith("febe")) return FEBE;
  if (n.startsWith("mikun")) return MIKUN;
  return GENERIC.map((g) => ({ ...g, q: g.q.replace("@NAME", "@" + name) }));
}

const FORMAT = {
  yesno: { label: "Yes / No", fg: C.yesDeep, bg: C.yesSoft },
  overunder: { label: "Over / Under", fg: C.goldDeep, bg: C.goldSoft },
  multi: { label: "This or That", fg: "#285C8C", bg: C.blueSoft },
};

export function Suggestions({ members, meId, onPick }: { members: Member[]; meId?: string; onPick: (d: Draft) => void }) {
  const others = members.filter((m) => m._id !== meId);
  const cards: { m: Member; idea: Idea }[] = [];
  const lists = others.map((m) => ideasFor(m.name));
  for (let i = 0; cards.length < 9 && lists.some((l) => i < l.length) ; i++) {
    others.forEach((m, k) => {
      if (cards.length < 9 && lists[k][i]) cards.push({ m, idea: lists[k][i] });
    });
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 11.5, color: C.sub, letterSpacing: 0.4 }}>✦ Suggested from what you shared · on-device</Text>
      {cards.map(({ m, idea }) => {
        const f = FORMAT[idea.kind];
        const chip = idea.kind === "overunder" ? "Over / Under " + (idea.line ?? 2.5) : f.label;
        return (
          <Pressable
            key={m._id + idea.q}
            onPress={() => onPick({ subjectId: m._id, kind: idea.kind, question: idea.q, line: idea.line, options: idea.options })}
            style={({ pressed }) => [s.card, { gap: 10, padding: 14, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.paper, borderRadius: 999, paddingVertical: 4, paddingLeft: 7, paddingRight: 11 }}>
                <Text style={{ fontSize: 14 }}>{m.emoji}</Text>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.ink }}>@{m.name}</Text>
              </View>
              <View style={{ backgroundColor: f.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: f.fg, letterSpacing: 0.6, textTransform: "uppercase" }}>{chip}</Text>
              </View>
            </View>
            <Text style={[s.h2, { fontSize: 19, lineHeight: 24 }]}>{idea.q}</Text>
            {idea.options ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.yesDeep }}>{idea.options[0]}</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>vs</Text>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.noDeep }}>{idea.options[1]}</Text>
              </View>
            ) : null}
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.sub }}>Why this bet? {idea.why}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
