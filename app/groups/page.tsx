import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CreateGroupForm from "./create-group-form";
import JoinGroupForm from "./join-group-form";

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ manage?: string }>;
}) {
  const headersList = await headers();
  const userId = headersList.get("x-user-id");

  if (!userId) {
    redirect("/login?next=/groups");
  }

  const { manage } = await searchParams;

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("group_members")
    .select("groups(id, name)")
    .eq("user_id", userId);

  const groups = (memberships ?? [])
    .map((m) => m.groups as unknown as { id: string; name: string } | null)
    .filter((g): g is { id: string; name: string } => g !== null);

  // Auto-redirect straight into the user's one group for convenience on a
  // plain visit — but ?manage=1 (from the group switcher's "+" link) opts
  // out, since that's the only way to reach create/join with one group.
  if (groups.length === 1 && !manage) {
    redirect(`/groups/${groups[0].id}/chat`);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-zinc-50 dark:bg-black px-4 py-10">
      <h1 className="text-xl font-semibold">הקבוצות שלי</h1>

      {groups.length > 0 && (
        <div className="flex w-full max-w-sm flex-col gap-2">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}/chat`}
              className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}

      {groups.length === 0 && (
        <p className="text-sm text-zinc-400 text-center max-w-sm">
          עדיין אין לך קבוצות — צור/י קבוצה חדשה, או הצטרף/י לקבוצה קיימת עם קוד הזמנה.
        </p>
      )}

      <div className="flex w-full max-w-sm flex-col gap-6">
        <CreateGroupForm />
        <JoinGroupForm />
      </div>
    </div>
  );
}
