import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import FeedbackForm from "./feedback-form";

export default async function FeedbackPage({
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
    redirect(`/login?next=/groups/${groupId}/feedback`);
  }

  const supabase = await createClient();
  const [{ data: profile }, { data: group }] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", userId).single(),
    supabase.from("groups").select("name").eq("id", groupId).single(),
  ]);

  return (
    <FeedbackForm
      groupId={groupId}
      senderLabel={profile?.username ?? userEmail ?? "משתמש"}
      groupName={group?.name ?? ""}
    />
  );
}
