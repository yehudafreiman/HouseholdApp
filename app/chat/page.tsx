import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatRoom from "./chat-room";

export default async function ChatPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  const { data: messages } = await supabase
    .from("messages")
    .select(
      "id, content, created_at, updated_at, user_id, profiles(username), message_reactions(id, emoji, user_id, profiles(username))"
    )
    .order("created_at", { ascending: true })
    .limit(100);

  return (
    <ChatRoom
      currentUserId={user.id}
      currentUsername={profile?.username ?? user.email ?? "אני"}
      initialMessages={
        (messages ?? []).map((m) => ({
          id: m.id,
          content: m.content,
          created_at: m.created_at,
          updated_at: m.updated_at,
          user_id: m.user_id,
          // Supabase returns the joined row as an object here since it's a to-one relationship
          username: (m.profiles as unknown as { username: string } | null)?.username ?? "משתמש",
          reactions: (
            (m.message_reactions ?? []) as unknown as {
              id: number;
              emoji: string;
              user_id: string;
              profiles: { username: string } | null;
            }[]
          ).map((r) => ({
            id: r.id,
            emoji: r.emoji,
            user_id: r.user_id,
            username: r.profiles?.username ?? "משתמש",
          })),
        }))
      }
    />
  );
}
