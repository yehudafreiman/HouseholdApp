"use client";

import { useRouter } from "next/navigation";

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

  if (groups.length <= 1) {
    return (
      <span className="text-sm font-medium">
        {groups[0]?.name ?? ""}
      </span>
    );
  }

  return (
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
  );
}
