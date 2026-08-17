import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_GROUP_ID } from "@/lib/shopping";
import ShoppingList from "./shopping-list";

export default async function ShoppingPage() {
  const headersList = await headers();
  const userId = headersList.get("x-user-id");
  const userEmail = headersList.get("x-user-email");

  // proxy.ts already verified the session (and redirects unauthenticated
  // requests to /login before this ever renders) — this is just defense in
  // depth in case proxy coverage is ever misconfigured.
  if (!userId) {
    redirect("/login");
  }

  const supabase = await createClient();

  // The all-profiles fetch already includes the current user's own row, so
  // there's no need for a separate profile-by-id query for the username.
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
      currentUserId={userId}
      currentUsername={profileMap[userId] ?? userEmail ?? "אני"}
      initialItems={items ?? []}
      initialProfiles={profileMap}
    />
  );
}
