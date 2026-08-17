import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_GROUP_ID } from "@/lib/shopping";
import ShoppingList from "./shopping-list";

export default async function ShoppingPage() {
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

  const [{ data: items }, { data: profiles }] = await Promise.all([
    supabase
      .from("shopping_items")
      .select(
        "id, name, category, quantity, estimated_price, is_checked, added_by, checked_by, checked_at, created_at"
      )
      .eq("group_id", DEFAULT_GROUP_ID)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, username"),
  ]);

  const profileMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    profileMap[p.id] = p.username;
  }

  return (
    <ShoppingList
      currentUserId={user.id}
      currentUsername={profile?.username ?? user.email ?? "אני"}
      initialItems={items ?? []}
      initialProfiles={profileMap}
    />
  );
}
