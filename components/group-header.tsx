"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import GroupSwitcher from "./group-switcher";

const TABS = [
  { key: "chat", icon: "💬", label: "צ'אט" },
  { key: "shopping", icon: "🛒", label: "קניות" },
  { key: "wishlist", icon: "⭐", label: "משאלות" },
] as const;

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
    <div className="border-b border-black/10 dark:border-white/10">
      {/* Identity + secondary utility actions — deliberately smaller and
          more muted than the tab bar below, so the two rows read as
          "who/where" vs "which section", not as two rows of equal-weight
          icons competing for attention (the confusion this replaced). */}
      <header className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <div className="flex flex-col">
          <GroupSwitcher groupId={groupId} groups={groups} activeTab={activeTab} />
          {subtitle}
        </div>
        <div className="flex items-center gap-3">
          {extraActions}
          <Link
            href={`/groups/${groupId}/invite`}
            className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            aria-label="הזמנת חברים"
          >
            🔗
          </Link>
          <Link
            href={`/groups/${groupId}/feedback`}
            className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            aria-label="דיווח על בעיה / הצעה לשיפור"
          >
            📮
          </Link>
          <button
            onClick={handleSignOut}
            className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            התנתקות
          </button>
        </div>
      </header>

      {/* Primary navigation: a real tab bar, always showing all three
          sections (including the current one) with an explicit active
          state — the previous version hid the current page's own icon,
          which meant there was no "you are here" signal at all. */}
      <nav className="flex items-center gap-1 px-3 pb-2">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`/groups/${groupId}/${tab.key}`}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-foreground text-background"
                  : "text-zinc-500 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
