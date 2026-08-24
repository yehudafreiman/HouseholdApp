import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const headersList = await headers();
  const userId = headersList.get("x-user-id");

  // proxy.ts already redirects unauthenticated requests away from /groups
  // before they reach here — this is just defense in depth, and costs
  // nothing (no network call) since the header is already on the request.
  if (!userId) {
    redirect(`/login?next=/groups/${groupId}`);
  }

  // A membership pre-check here used to add a full extra Supabase round
  // trip (~250-400ms measured) to every single in-group navigation, on
  // top of the page's own queries — for a UX nicety (an explicit redirect
  // instead of an empty room for a non-member) rather than security: RLS
  // already scopes every query below by group membership regardless, so a
  // non-member gets an empty page, not someone else's data. Trading that
  // rare-case nicety for a real, permanent latency win on every navigation.
  return <>{children}</>;
}
