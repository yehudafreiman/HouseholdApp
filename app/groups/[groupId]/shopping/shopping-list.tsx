"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { SHOPPING_CATEGORIES } from "@/lib/shopping";
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

function sortItems(list: ShoppingItemRow[]) {
  return [...list].sort((a, b) => {
    if (a.is_checked !== b.is_checked) return a.is_checked ? 1 : -1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export default function ShoppingList({
  groupId,
  groups,
  currentUserId,
  currentUsername,
  initialItems,
  initialProfiles,
  frequentItems,
}: {
  groupId: string;
  groups: { id: string; name: string }[];
  currentUserId: string;
  currentUsername: string;
  initialItems: ShoppingItemRow[];
  initialProfiles: Record<string, string>;
  frequentItems: FrequentItem[];
}) {
  const [items, setItems] = useState<ShoppingItemRow[]>(initialItems);
  const [profiles, setProfiles] = useState<Record<string, string>>(initialProfiles);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fetchingProfiles = useRef<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Resolve any added_by/checked_by user IDs we don't have a username for
  // yet (e.g. a new item from someone who joined after the initial load).
  useEffect(() => {
    const missingIds = new Set<string>();
    for (const item of items) {
      if (!profiles[item.added_by]) missingIds.add(item.added_by);
      if (item.checked_by && !profiles[item.checked_by]) missingIds.add(item.checked_by);
    }
    const idsToFetch = [...missingIds].filter((id) => !fetchingProfiles.current.has(id));
    if (idsToFetch.length === 0) return;
    idsToFetch.forEach((id) => fetchingProfiles.current.add(id));

    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, username")
      .in("id", idsToFetch)
      .then(({ data }) => {
        if (!data) return;
        setProfiles((prev) => {
          const next = { ...prev };
          for (const p of data) next[p.id] = p.username;
          return next;
        });
      });
  }, [items, profiles]);

  useEffect(() => {
    const supabase = createClient();

    // Wishlist items live in the same table (is_wishlist = true) and are
    // excluded from the initial fetch — but Realtime's own `filter` string
    // already burned this app once (the DELETE-event group_id filter
    // silently dropped every event), so a second equality clause isn't
    // trusted here either. Filtering happens client-side instead.
    const handleInsert = (payload: RealtimePostgresInsertPayload<ShoppingItemRow>) => {
      const row = payload.new;
      if (row.is_wishlist) return;
      setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [...prev, row]));
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<ShoppingItemRow>) => {
      const row = payload.new;
      if (row.is_wishlist) {
        setItems((prev) => prev.filter((i) => i.id !== row.id));
        return;
      }
      // A promoted wishlist item ("עברתי לקנייה") was never in local state,
      // so this needs to add it, not just map over existing entries.
      setItems((prev) => {
        const exists = prev.some((i) => i.id === row.id);
        return exists ? prev.map((i) => (i.id === row.id ? row : i)) : [...prev, row];
      });
    };

    const handleDelete = (payload: RealtimePostgresDeletePayload<ShoppingItemRow>) => {
      const deletedId = payload.old.id;
      if (deletedId === undefined) return;
      setItems((prev) => prev.filter((i) => i.id !== deletedId));
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
  }, [groupId]);

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
                const addedByName = profiles[item.added_by] ?? "משתמש";
                const checkedByName = item.checked_by ? profiles[item.checked_by] : null;

                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 pr-1 pl-3 py-1 ${
                      item.is_checked ? "opacity-50" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleChecked(item)}
                      className="flex flex-1 min-w-0 items-center gap-3 py-2 text-right"
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${
                          item.is_checked
                            ? "border-foreground bg-foreground text-background"
                            : "border-black/20 dark:border-white/25"
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
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 text-base"
                      aria-label="מחיקת פריט"
                    >
                      🗑
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
            <button
              key={s.name}
              type="button"
              onClick={() => handleQuickAdd(s)}
              className="shrink-0 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-1 text-xs whitespace-nowrap hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              + {s.name}
            </button>
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
            placeholder="הוספת פריט... (למשל: חלב, עגבניות)"
            className="min-w-0 flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="shrink-0 rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            הוספה
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="כמות (אופציונלי)"
            className="min-w-0 flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="מחיר ₪ (אופציונלי)"
            className="min-w-0 flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
        </div>
        <span className="text-[11px] text-zinc-500 px-2">
          מחובר/ת בתור {currentUsername}
        </span>
      </form>
    </div>
  );
}
