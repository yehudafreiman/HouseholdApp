import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import InviteCodeDisplay from "./invite-code-display";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const headersList = await headers();
  const userId = headersList.get("x-user-id");

  if (!userId) {
    redirect(`/login?next=/groups/${groupId}/invite`);
  }

  const supabase = await createClient();
  const [{ data: group }, { data: membership }] = await Promise.all([
    supabase.from("groups").select("id, name, invite_code").eq("id", groupId).single(),
    supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .single(),
  ]);

  if (!group) {
    notFound();
  }

  return (
    <InviteCodeDisplay
      groupId={groupId}
      groupName={group.name}
      inviteCode={group.invite_code}
      isOwner={membership?.role === "owner"}
    />
  );
}
