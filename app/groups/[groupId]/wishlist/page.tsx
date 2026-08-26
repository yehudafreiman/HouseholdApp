import { redirect } from "next/navigation";
import { headers } from "next/headers";
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

  // No Supabase calls here — see shopping/page.tsx for why.
  return (
    <Wishlist
      key={groupId}
      groupId={groupId}
      currentUserId={userId}
      currentUserEmail={userEmail}
    />
  );
}
