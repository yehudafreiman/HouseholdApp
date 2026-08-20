"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export default function GroupSwitcher({
  groupId,
  groups,
  activeTab,
}: {
  groupId: string;
  groups: { id: string; name: string }[];
  activeTab: "chat" | "shopping";
}) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-1.5">
      {groups.length <= 1 ? (
        <span className="text-sm font-medium">{groups[0]?.name ?? ""}</span>
      ) : (
        <select
          value={groupId}
          onChange={(e) => router.push(`/groups/${e.target.value}/${activeTab}`)}
          className="bg-transparent text-sm font-medium outline-none"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <Link
        href="/groups?manage=1"
        className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
        aria-label="ניהול קבוצות"
        title="קבוצה חדשה / הצטרפות לקבוצה"
      >
        +
      </Link>
    </div>
  );
}
