import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Id } from "@convex/_generated/dataModel";
import { useIdentity } from "@/lib/identity";
import { Thread } from "@/components/chat/thread";
import { ChatJoin } from "@/components/chat/join";
import { I } from "@/components/chat/ios";

export default function GroupChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, ready } = useIdentity();
  if (!ready) return <View style={{ flex: 1, backgroundColor: I.bg }} />;
  if (!token) return <ChatJoin />;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <Thread token={token} groupId={id as Id<"groups">} />
    </>
  );
}
