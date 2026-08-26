import { redirect } from "next/navigation";
import { headers } from "next/headers";
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

  // No Supabase calls here anymore — items/groups/profiles are fetched
  // client-side (see shopping-list.tsx) through TanStack Query, so this
  // route's server render has nothing to wait on and the navigation itself
  // is instant. The query cache then serves cached data immediately on
  // repeat visits while revalidating in the background.
  return (
    <ShoppingList
      key={groupId}
      groupId={groupId}
      currentUserId={userId}
      currentUserEmail={userEmail}
    />
  );
}
