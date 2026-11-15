import { useState } from "react";
import { Pressable, Text, TextInput, View, ScrollView } from "react-native";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { newToken, useIdentity } from "@/lib/identity";
import { isSingleEmoji, lastGrapheme } from "@/lib/emoji";
import { C, F } from "@/lib/theme";
import { Button, Card, Wordmark, s } from "./ui";

const EMOJIS = ["🦊", "🐸", "🦖", "🍕", "🛸", "🪩", "👾", "🥨"];

export function Join() {
  const join = useMutation(api.users.join);
  const { setToken } = useIdentity();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim() || busy) return;
    if (!isSingleEmoji(emoji)) {
      setErr("Pick one emoji for your face");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const token = newToken();
      await join({ name, emoji, token });
      setToken(token);
    } catch (e) {
      const data = (e as { data?: unknown }).data;
      setErr(typeof data === "string" ? data : "Couldn't join. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.column, { paddingTop: 56, paddingBottom: 40, gap: 22 }]}>
      <Wordmark size={30} />
      <View style={{ gap: 6 }}>
        <Text style={s.h1}>Call it before it happens.</Text>
        <Text style={[s.body, { color: C.sub, lineHeight: 22 }]}>
          A new drop of bets lands every hour. Stake your points, beat the room, keep your streak alive.
        </Text>
      </View>
      <Card style={{ gap: 16 }}>
        <Text style={s.label}>Your name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Mikun"
          placeholderTextColor={C.faint}
          maxLength={20}
          onSubmitEditing={submit}
          style={{
            fontFamily: F.bodyMed,
            fontSize: 20,
            color: C.ink,
            backgroundColor: C.paper,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        />
        <Text style={s.label}>Your face · any emoji</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TextInput
            value={emoji}
            onChangeText={(t) => setEmoji(t ? lastGrapheme(t) : "")}
            placeholder="🙂"
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              textAlign: "center",
              fontSize: 34,
              backgroundColor: isSingleEmoji(emoji) ? C.goldSoft : C.paper,
              borderWidth: 2,
              borderColor: isSingleEmoji(emoji) ? C.gold : C.line,
            }}
          />
          <Text style={[s.sub, { flex: 1 }]}>Tap the box and pick anything from your emoji keyboard, or grab one:</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => setEmoji(e)}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: emoji === e ? C.goldSoft : C.paper,
                transform: [{ scale: pressed ? 0.9 : 1 }],
              })}
            >
              <Text style={{ fontSize: 20 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
        {err ? <Text style={{ fontFamily: F.bodyMed, color: C.no, fontSize: 14 }}>{err}</Text> : null}
        <Button label={busy ? "Joining…" : "Join with 1,000 points"} onPress={submit} disabled={!name.trim() || busy} color={C.yes} />
      </Card>
      <Text style={[s.sub, { textAlign: "center" }]}>No password. This device remembers you.</Text>
    </ScrollView>
  );
}
