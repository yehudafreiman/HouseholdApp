import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import ChatRoom from "./chat-room";

export default async function GroupChatPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const headersList = await headers();
  const userId = headersList.get("x-user-id");
  const userEmail = headersList.get("x-user-email");

  // The [groupId] layout already verified membership — this is defense in
  // depth in case proxy/layout coverage is ever misconfigured.
  if (!userId) {
    redirect(`/login?next=/groups/${groupId}/chat`);
  }

  const supabase = await createClient();

  const [{ data: profile }, { data: messages }, { data: group }, { data: memberships }] =
    await Promise.all([
      supabase.from("profiles").select("username").eq("id", userId).single(),
      supabase
        .from("messages")
        .select(
          "id, content, created_at, updated_at, user_id, attachment_path, attachment_name, attachment_type, attachment_size, profiles(username), message_reactions(id, emoji, user_id, profiles(username))"
        )
        .eq("group_id", groupId)
        .order("created_at", { ascending: true })
        .limit(100),
      supabase.from("groups").select("name").eq("id", groupId).single(),
      supabase.from("group_members").select("groups(id, name)").eq("user_id", userId),
    ]);

  const groups = (memberships ?? [])
    .map((m) => m.groups as unknown as { id: string; name: string } | null)
    .filter((g): g is { id: string; name: string } => g !== null);

  return (
    <ChatRoom
      key={groupId}
      groupId={groupId}
      groupName={group?.name ?? ""}
      groups={groups}
      currentUserId={userId}
      currentUsername={profile?.username ?? userEmail ?? "אני"}
      initialMessages={
        (messages ?? []).map((m) => ({
          id: m.id,
          content: m.content,
          created_at: m.created_at,
          updated_at: m.updated_at,
          user_id: m.user_id,
          attachment_path: m.attachment_path,
          attachment_name: m.attachment_name,
          attachment_type: m.attachment_type,
          attachment_size: m.attachment_size,
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
