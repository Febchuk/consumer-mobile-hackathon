import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { C, F, tnum } from "@/lib/theme";
import { isSingleEmoji, lastGrapheme } from "@/lib/emoji";
import { Button, s } from "./ui";

function errText(e: unknown) {
  const d = (e as { data?: unknown }).data;
  return typeof d === "string" ? d : "Something went wrong";
}

const input = {
  fontFamily: F.bodyMed,
  fontSize: 16,
  color: C.ink,
  backgroundColor: C.paper,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
};

export function ProfileEditor({ token, name, emoji, onDone }: { token: string; name: string; emoji: string; onDone: () => void }) {
  const save = useMutation(api.users.setProfile);
  const [u, setU] = useState(name);
  const [e, setE] = useState(emoji);
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 8, width: "100%" }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={e}
          onChangeText={(t) => setE(t ? lastGrapheme(t) : "")}
          style={[input, { width: 56, textAlign: "center", fontSize: 24 }]}
        />
        <View style={[input, { flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 0 }]}>
          <Text style={{ fontFamily: F.bodyBold, color: C.faint, fontSize: 16 }}>@</Text>
          <TextInput
            value={u}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(t) => setU(t.replace(/^@+/, "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_.]/g, "").slice(0, 20))}
            style={{ flex: 1, fontFamily: F.bodyMed, fontSize: 16, color: C.ink, paddingVertical: 10 }}
          />
        </View>
      </View>
      {err ? <Text style={{ color: C.no, fontFamily: F.bodyMed }}>{err}</Text> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          small
          label="Save"
          color={C.yes}
          disabled={u.length < 2 || !isSingleEmoji(e)}
          onPress={async () => {
            try {
              await save({ token, username: u, emoji: e });
              onDone();
            } catch (x) {
              setErr(errText(x));
            }
          }}
        />
        <Button small label="Cancel" color={C.tile} textColor={C.ink} onPress={onDone} />
      </View>
    </View>
  );
}

export function MyGroups({ token }: { token: string }) {
  const groups = useQuery(api.groups.mine, { token });
  const create = useMutation(api.groups.create);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.label, { marginTop: 6 }]}>Your groups</Text>
      {(groups ?? []).map((g) => (
        <Link key={g._id} href={{ pathname: "/group/[id]", params: { id: g._id } }} asChild>
          <Pressable
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: g.isDefault ? C.yesSoft : C.card,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: g.isDefault ? C.yes : C.line,
              padding: 14,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <Text style={{ fontFamily: F.displaySemi, fontSize: 18, color: C.ink, flex: 1 }}>{g.name}</Text>
            <Text style={[s.sub, tnum]}>{g.members} in</Text>
            <Text style={{ fontFamily: F.bodyBold, color: C.sub }}>›</Text>
          </Pressable>
        </Link>
      ))}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="New group, e.g. Roommates"
          placeholderTextColor={C.faint}
          style={[input, { flex: 1 }]}
        />
        <Button
          small
          label="Create"
          disabled={name.trim().length < 2}
          onPress={async () => {
            setErr(null);
            try {
              const id = await create({ token, name });
              setName("");
              router.push({ pathname: "/group/[id]", params: { id } });
            } catch (x) {
              setErr(errText(x));
            }
          }}
        />
      </View>
      {err ? <Text style={{ color: C.no, fontFamily: F.bodyMed }}>{err}</Text> : null}
    </View>
  );
}
