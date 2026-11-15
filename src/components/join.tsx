import { useState } from "react";
import { Pressable, Text, TextInput, View, ScrollView } from "react-native";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { newToken, useIdentity } from "@/lib/identity";
import { C, F } from "@/lib/theme";
import { Button, Card, Wordmark, s } from "./ui";

const EMOJIS = ["🦊", "🐸", "🦄", "🐙", "🦖", "🐝", "🍕", "🌶️", "🎲", "🛸", "🧃", "🪩", "🐢", "🦩", "👾", "🥨"];

export function Join() {
  const join = useMutation(api.users.join);
  const { setToken } = useIdentity();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const token = newToken();
    try {
      await join({ name, emoji, token });
      setToken(token);
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
          autoFocus
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
        <Text style={s.label}>Pick your face</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => setEmoji(e)}
              style={({ pressed }) => ({
                width: 48,
                height: 48,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: emoji === e ? C.goldSoft : C.paper,
                borderWidth: 2,
                borderColor: emoji === e ? C.gold : "transparent",
                transform: [{ scale: pressed ? 0.9 : emoji === e ? 1.06 : 1 }],
              })}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
        <Button label={busy ? "Joining…" : "Join with 1,000 points"} onPress={submit} disabled={!name.trim() || busy} color={C.yes} />
      </Card>
      <Text style={[s.sub, { textAlign: "center" }]}>No password. This device remembers you.</Text>
    </ScrollView>
  );
}
