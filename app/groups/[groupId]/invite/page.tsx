import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import InviteCodeDisplay from "./invite-code-display";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const supabase = await createClient();

  // This page decides whether to show a real, destructive action (delete
  // group) based on identity, so — unlike the other page.tsx files, which
  // only use the x-user-id header for UX labels/redirects — it can't trust
  // that header (proxy.ts reads it from the cookie locally, unverified;
  // see the comment in lib/supabase/proxy.ts). getUser() actually verifies
  // the session against Supabase before we use it for this decision. This
  // page isn't part of the fast chat/shopping/wishlist navigation loop, so
  // paying that one network round trip here doesn't cost anything that
  // matters.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/groups/${groupId}/invite`);
  }

  const [{ data: group }, { data: membership }] = await Promise.all([
    supabase.from("groups").select("id, name, invite_code").eq("id", groupId).single(),
    supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
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
