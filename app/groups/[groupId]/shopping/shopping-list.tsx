"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { SHOPPING_CATEGORIES } from "@/lib/shopping";
import { useGroupMeta } from "@/lib/hooks/use-group-meta";
import GroupHeader from "@/components/group-header";

type ShoppingItemRow = {
  id: number;
  name: string;
  category: string | null;
  quantity: string | null;
  estimated_price: number | null;
  is_checked: boolean;
  is_wishlist: boolean;
  added_by: string;
  checked_by: string | null;
  checked_at: string | null;
  created_at: string;
};

type FrequentItem = { name: string; category: string | null };

const ITEMS_KEY = (groupId: string) => ["shopping-items", groupId] as const;
const STATS_KEY = (groupId: string) => ["shopping-stats", groupId] as const;

function sortItems(list: ShoppingItemRow[]) {
  return [...list].sort((a, b) => {
    if (a.is_checked !== b.is_checked) return a.is_checked ? 1 : -1;
    return a.created_at.localeCompare(b.created_at);
  });
}

async function fetchItems(groupId: string): Promise<ShoppingItemRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("shopping_items")
    .select(
      "id, name, category, quantity, estimated_price, is_checked, is_wishlist, added_by, checked_by, checked_at, created_at"
    )
    .eq("group_id", groupId)
    .eq("is_wishlist", false)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function fetchStats(groupId: string): Promise<FrequentItem[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("shopping_item_stats")
    .select("name, category")
    .eq("group_id", groupId)
    .gte("times_bought", 2)
    .order("times_bought", { ascending: false })
    .limit(10);
  return data ?? [];
}

export default function ShoppingList({
  groupId,
  currentUserId,
  currentUserEmail,
}: {
  groupId: string;
  currentUserId: string;
  currentUserEmail: string | null;
}) {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: meta } = useGroupMeta(currentUserId, currentUserEmail);
  const groups = meta?.groups ?? [];
  const profileMap = useMemo(() => meta?.profileMap ?? {}, [meta]);
  const currentUsername = meta?.currentUsername ?? currentUserEmail ?? "אני";

  const { data: itemsData } = useQuery({
    queryKey: ITEMS_KEY(groupId),
    queryFn: () => fetchItems(groupId),
  });
  const items = useMemo(() => itemsData ?? [], [itemsData]);

  const { data: statsData } = useQuery({
    queryKey: STATS_KEY(groupId),
    queryFn: () => fetchStats(groupId),
  });
  const frequentItems = statsData ?? [];

  // If an item references a user we don't have a username for yet (e.g.
  // someone joined mid-session after group-meta was cached), refresh it.
  useEffect(() => {
    const missing = items.some(
      (item) => !profileMap[item.added_by] || (item.checked_by && !profileMap[item.checked_by])
    );
    if (missing) {
      queryClient.invalidateQueries({ queryKey: ["group-meta", currentUserId] });
    }
  }, [items, profileMap, currentUserId, queryClient]);

  useEffect(() => {
    const supabase = createClient();

    // Wishlist items live in the same table (is_wishlist = true) and are
    // excluded from the fetch — but Realtime's own `filter` string already
    // burned this app once (the DELETE-event group_id filter silently
    // dropped every event), so a second equality clause isn't trusted here
    // either. Filtering happens client-side instead.
    const handleInsert = (payload: RealtimePostgresInsertPayload<ShoppingItemRow>) => {
      const row = payload.new;
      if (row.is_wishlist) return;
      queryClient.setQueryData<ShoppingItemRow[]>(ITEMS_KEY(groupId), (prev) =>
        (prev ?? []).some((i) => i.id === row.id) ? (prev ?? []) : [...(prev ?? []), row]
      );
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<ShoppingItemRow>) => {
      const row = payload.new;
      queryClient.setQueryData<ShoppingItemRow[]>(ITEMS_KEY(groupId), (prev) => {
        const list = prev ?? [];
        if (row.is_wishlist) return list.filter((i) => i.id !== row.id);
        // A promoted wishlist item ("עברתי לקנייה") was never in the cache,
        // so this needs to add it, not just map over existing entries.
        const exists = list.some((i) => i.id === row.id);
        return exists ? list.map((i) => (i.id === row.id ? row : i)) : [...list, row];
      });
    };

    const handleDelete = (payload: RealtimePostgresDeletePayload<ShoppingItemRow>) => {
      const deletedId = payload.old.id;
      if (deletedId === undefined) return;
      queryClient.setQueryData<ShoppingItemRow[]>(ITEMS_KEY(groupId), (prev) =>
        (prev ?? []).filter((i) => i.id !== deletedId)
      );
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;

      // Channel name is per-group so switching groups tears down and
      // rebuilds a fresh subscription scoped to the new group.
      let ch: RealtimeChannel = supabase.channel(`shopping-items-changes-${groupId}`);
      ch = ch.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "shopping_items",
          filter: `group_id=eq.${groupId}`,
        },
        handleInsert
      );
      ch = ch.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "shopping_items",
          filter: `group_id=eq.${groupId}`,
        },
        handleUpdate
      );
      // No filter on DELETE: without REPLICA IDENTITY FULL, a delete's
      // "old" row only carries the primary key, not group_id — a filter
      // referencing group_id would never match and Realtime would drop
      // every delete event silently. handleDelete only matches by id
      // against the current group's already-loaded items, so an
      // unfiltered delete from another group is a harmless no-op locally.
      ch = ch.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "shopping_items" },
        handleDelete
      );
      ch.subscribe();

      channel = ch;
      channelRef.current = channel;
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [groupId, queryClient]);

  // Categorizing calls an LLM and can take a few seconds — waiting on it
  // before the item even appears would make rapid-fire adding (typing
  // several items back to back while actually shopping) feel sluggish. The
  // item goes in immediately as "אחר"; this runs after, in the background,
  // and updates the row's category once it resolves. Everyone (including
  // this tab) picks up the change via the existing realtime UPDATE handler.
  function categorizeInBackground(itemId: number, itemName: string) {
    fetch("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: itemName }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { category?: string } | null) => {
        if (!data?.category || data.category === "אחר") return;
        const supabase = createClient();
        return supabase
          .from("shopping_items")
          .update({ category: data.category })
          .eq("id", itemId);
      })
      .catch(() => {
        // Background best-effort — the item just stays "אחר".
      });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);

    const supabase = createClient();
    const trimmedQuantity = quantity.trim();
    const trimmedPrice = price.trim();
    const { data, error } = await supabase
      .from("shopping_items")
      .insert({
        group_id: groupId,
        name: trimmed,
        category: "אחר",
        quantity: trimmedQuantity || null,
        estimated_price: trimmedPrice ? Number(trimmedPrice) : null,
        added_by: currentUserId,
      })
      .select("id")
      .single();

    if (!error) {
      setName("");
      setQuantity("");
      setPrice("");
    }
    setSubmitting(false);

    if (!error && data) {
      categorizeInBackground(data.id, trimmed);
    }
  }

  // Quick-add for a "frequently bought" chip — the category is already
  // known from purchase history, so this skips the AI call entirely
  // (faster than a regular add, not just as fast).
  async function handleQuickAdd(item: FrequentItem) {
    const supabase = createClient();
    await supabase.from("shopping_items").insert({
      group_id: groupId,
      name: item.name,
      category: item.category ?? "אחר",
      added_by: currentUserId,
    });
  }

  async function handleDismissSuggestion(item: FrequentItem) {
    const supabase = createClient();
    const { error } = await supabase
      .from("shopping_item_stats")
      .delete()
      .eq("group_id", groupId)
      .eq("name", item.name);
    if (!error) {
      queryClient.setQueryData<FrequentItem[]>(STATS_KEY(groupId), (prev) =>
        (prev ?? []).filter((f) => f.name !== item.name)
      );
    }
  }

  async function toggleChecked(item: ShoppingItemRow) {
    const supabase = createClient();
    if (item.is_checked) {
      await supabase
        .from("shopping_items")
        .update({ is_checked: false, checked_by: null, checked_at: null })
        .eq("id", item.id);
    } else {
      await supabase
        .from("shopping_items")
        .update({
          is_checked: true,
          checked_by: currentUserId,
          checked_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      // Fire-and-forget: feeds the "frequently bought" quick-add
      // suggestions on the next page load, doesn't need to block checking
      // the item off.
      supabase
        .rpc("bump_item_stat", {
          p_group_id: groupId,
          p_name: item.name,
          p_category: item.category,
        })
        .then(() => {});
    }
  }

  async function handleDeleteItem(id: number) {
    const supabase = createClient();
    await supabase.from("shopping_items").delete().eq("id", id);
  }

  async function handleClearChecked() {
    const checkedIds = items.filter((i) => i.is_checked).map((i) => i.id);
    if (checkedIds.length === 0) return;
    const supabase = createClient();
    await supabase.from("shopping_items").delete().in("id", checkedIds);
  }

  const grouped = new Map<string, ShoppingItemRow[]>();
  for (const item of items) {
    const cat = item.category ?? "אחר";
    const list = grouped.get(cat) ?? [];
    list.push(item);
    grouped.set(cat, list);
  }

  const knownCategories: string[] = [...SHOPPING_CATEGORIES];
  const orderedCategories = [
    ...knownCategories.filter((c) => grouped.has(c)),
    ...[...grouped.keys()].filter((c) => !knownCategories.includes(c)),
  ];

  const uncheckedCount = items.filter((i) => !i.is_checked).length;
  const checkedCount = items.length - uncheckedCount;
  const totalEstimated = items
    .filter((i) => !i.is_checked && i.estimated_price != null)
    .reduce((sum, i) => sum + Number(i.estimated_price), 0);

  // Don't suggest something that's already sitting on the active list.
  const activeNames = new Set(items.filter((i) => !i.is_checked).map((i) => i.name));
  const suggestions = frequentItems.filter((f) => !activeNames.has(f.name));

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-black">
      <GroupHeader
        groupId={groupId}
        groups={groups}
        activeTab="shopping"
        subtitle={
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <span>
              {uncheckedCount} פריטים לקנייה
              {totalEstimated > 0 && ` · כ-${totalEstimated.toFixed(0)} ₪`}
            </span>
            {checkedCount > 0 && (
              <button
                type="button"
                onClick={handleClearChecked}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                נקה מסומנים ({checkedCount})
              </button>
            )}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
        {items.length === 0 && (
          <p className="text-center text-sm text-zinc-400 mt-8">
            הרשימה ריקה — הוסיפו את הפריט הראשון למטה.
          </p>
        )}

        {orderedCategories.map((category) => (
          <div key={category} className="flex flex-col gap-1.5">
            <h2 className="text-xs font-semibold text-zinc-500">{category}</h2>
            <div className="flex flex-col gap-1">
              {sortItems(grouped.get(category) ?? []).map((item) => {
                const addedByName = profileMap[item.added_by] ?? "משתמש";
                const checkedByName = item.checked_by ? profileMap[item.checked_by] : null;

                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-2 ${
                      item.is_checked ? "opacity-50" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleChecked(item)}
                      className="flex flex-1 min-w-0 items-center gap-2 py-2 text-right"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs transition-colors ${
                          item.is_checked
                            ? "border-foreground bg-foreground text-background"
                            : "border-black/10 dark:border-white/15"
                        }`}
                        aria-hidden="true"
                      >
                        {item.is_checked && "✓"}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-sm ${item.is_checked ? "line-through" : ""}`}
                          >
                            {item.name}
                          </span>
                          {item.quantity && (
                            <span className="text-xs text-zinc-400">×{item.quantity}</span>
                          )}
                          {item.estimated_price != null && (
                            <span className="text-xs text-zinc-400">
                              ~{Number(item.estimated_price).toFixed(0)} ₪
                            </span>
                          )}
                        </span>
                        <span className="block text-[10px] text-zinc-400">
                          {item.is_checked
                            ? `נקנה ע"י ${checkedByName ?? "משתמש"}`
                            : `נוסף ע"י ${addedByName}`}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="text-zinc-400 hover:text-red-600 text-sm shrink-0 px-1"
                      aria-label="מחיקת פריט"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-t border-black/10 dark:border-white/10 px-3 py-2">
          <span className="shrink-0 text-[11px] text-zinc-400">קונים לעיתים קרובות:</span>
          {suggestions.map((s) => (
            <span
              key={s.name}
              className="shrink-0 flex items-center rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 text-xs whitespace-nowrap"
            >
              <button
                type="button"
                onClick={() => handleQuickAdd(s)}
                className="px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                + {s.name}
              </button>
              <button
                type="button"
                onClick={() => handleDismissSuggestion(s)}
                className="px-2 py-1 text-zinc-400 hover:text-red-600"
                aria-label={`הסרת ההצעה ${s.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-2 border-t border-black/10 dark:border-white/10 p-3"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="הוספת פריט..."
            className="min-w-0 flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <input
            type="text"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="כמות"
            className="w-16 min-w-0 shrink-0 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="₪"
            className="w-14 min-w-0 shrink-0 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="shrink-0 rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            הוספה
          </button>
        </div>
        <span className="text-[11px] text-zinc-500 px-2">
          מחובר/ת בתור {currentUsername}
        </span>
      </form>
    </div>
  );
}
