import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import Wishlist from "./wishlist";

export default async function GroupWishlistPage({
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
    redirect(`/login?next=/groups/${groupId}/wishlist`);
  }

  const supabase = await createClient();

  const [{ data: items }, { data: profiles }, { data: memberships }] = await Promise.all([
    supabase
      .from("shopping_items")
      .select("id, name, category, quantity, estimated_price, is_wishlist, added_by, created_at")
      .eq("group_id", groupId)
      .eq("is_wishlist", true)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, username"),
    supabase.from("group_members").select("groups(id, name)").eq("user_id", userId),
  ]);

  const profileMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    profileMap[p.id] = p.username;
  }

  const groups = (memberships ?? [])
    .map((m) => m.groups as unknown as { id: string; name: string } | null)
    .filter((g): g is { id: string; name: string } => g !== null);

  return (
    <Wishlist
      key={groupId}
      groupId={groupId}
      groups={groups}
      currentUserId={userId}
      currentUsername={profileMap[userId] ?? userEmail ?? "אני"}
      initialItems={items ?? []}
      initialProfiles={profileMap}
    />
  );
}
