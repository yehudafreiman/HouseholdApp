"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import GroupSwitcher from "./group-switcher";

export default function GroupHeader({
  groupId,
  groups,
  activeTab,
  subtitle,
  extraActions,
}: {
  groupId: string;
  groups: { id: string; name: string }[];
  activeTab: "chat" | "shopping" | "wishlist";
  subtitle?: ReactNode;
  extraActions?: ReactNode;
}) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-4 py-3">
      <div className="flex flex-col">
        <GroupSwitcher groupId={groupId} groups={groups} activeTab={activeTab} />
        {subtitle}
      </div>
      <div className="flex items-center gap-3">
        {extraActions}
        {activeTab !== "chat" && (
          <Link
            href={`/groups/${groupId}/chat`}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            aria-label="צ'אט"
          >
            💬
          </Link>
        )}
        {activeTab !== "shopping" && (
          <Link
            href={`/groups/${groupId}/shopping`}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            aria-label="רשימת קניות"
          >
            🛒
          </Link>
        )}
        {activeTab !== "wishlist" && (
          <Link
            href={`/groups/${groupId}/wishlist`}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            aria-label="רשימת משאלות"
          >
            ⭐
          </Link>
        )}
        <Link
          href={`/groups/${groupId}/invite`}
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          aria-label="הזמנת חברים"
        >
          🔗
        </Link>
        <Link
          href={`/groups/${groupId}/feedback`}
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          aria-label="דיווח על בעיה / הצעה לשיפור"
        >
          📮
        </Link>
        <button
          onClick={handleSignOut}
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          התנתקות
        </button>
      </div>
    </header>
  );
}
