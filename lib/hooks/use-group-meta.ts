"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type GroupMeta = {
  groups: { id: string; name: string }[];
  profileMap: Record<string, string>;
  currentUsername: string;
};

// Shared by the chat/shopping/wishlist pages — the group list and profile
// map are the same regardless of which of those pages you're on, so they
// key only on userId, not groupId. Navigating between the three pages for
// the same group (or even switching groups) reuses this one cache entry
// instead of re-fetching it per page.
export function useGroupMeta(userId: string, userEmail: string | null) {
  return useQuery({
    queryKey: ["group-meta", userId],
    queryFn: async (): Promise<GroupMeta> => {
      const supabase = createClient();
      const [{ data: profiles }, { data: memberships }] = await Promise.all([
        supabase.from("profiles").select("id, username"),
        supabase.from("group_members").select("groups(id, name)").eq("user_id", userId),
      ]);

      const profileMap: Record<string, string> = {};
      for (const p of profiles ?? []) profileMap[p.id] = p.username;

      const groups = (memberships ?? [])
        .map((m) => m.groups as unknown as { id: string; name: string } | null)
        .filter((g): g is { id: string; name: string } => g !== null);

      return {
        groups,
        profileMap,
        currentUsername: profileMap[userId] ?? userEmail ?? "אני",
      };
    },
  });
}
