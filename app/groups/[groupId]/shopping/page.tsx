import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import ShoppingList from "./shopping-list";

export default async function GroupShoppingPage({
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
    redirect(`/login?next=/groups/${groupId}/shopping`);
  }

  const supabase = await createClient();

  // The all-profiles fetch already includes the current user's own row, so
  // there's no need for a separate profile-by-id query for the username.
  const [{ data: items }, { data: profiles }, { data: memberships }, { data: stats }] =
    await Promise.all([
      supabase
        .from("shopping_items")
        .select(
          "id, name, category, quantity, estimated_price, is_checked, is_wishlist, added_by, checked_by, checked_at, created_at"
        )
        .eq("group_id", groupId)
        .eq("is_wishlist", false)
        .order("created_at", { ascending: true }),
      supabase.from("profiles").select("id, username"),
      supabase.from("group_members").select("groups(id, name)").eq("user_id", userId),
      supabase
        .from("shopping_item_stats")
        .select("name, category")
        .eq("group_id", groupId)
        .gte("times_bought", 2)
        .order("times_bought", { ascending: false })
        .limit(10),
    ]);

  const profileMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    profileMap[p.id] = p.username;
  }

  const groups = (memberships ?? [])
    .map((m) => m.groups as unknown as { id: string; name: string } | null)
    .filter((g): g is { id: string; name: string } => g !== null);

  return (
    <ShoppingList
      key={groupId}
      groupId={groupId}
      groups={groups}
      currentUserId={userId}
      currentUsername={profileMap[userId] ?? userEmail ?? "אני"}
      initialItems={items ?? []}
      initialProfiles={profileMap}
      frequentItems={stats ?? []}
    />
  );
}
