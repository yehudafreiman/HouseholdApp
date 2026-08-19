import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

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

  if (!userId) {
    redirect(`/login?next=/groups/${groupId}`);
  }

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  // RLS alone would just return an empty room for a non-member (not an
  // error), which reads as a bug rather than "you're not in this group" —
  // this guard exists for that UX, RLS is still the real security boundary.
  if (!membership) {
    redirect("/groups");
  }

  return <>{children}</>;
}
