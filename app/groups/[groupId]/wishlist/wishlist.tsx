"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import GroupHeader from "@/components/group-header";

type WishlistItemRow = {
  id: number;
  name: string;
  category: string | null;
  quantity: string | null;
  estimated_price: number | null;
  is_wishlist: boolean;
  added_by: string;
  created_at: string;
};

export default function Wishlist({
  groupId,
  groups,
  currentUserId,
  currentUsername,
  initialItems,
  initialProfiles,
}: {
  groupId: string;
  groups: { id: string; name: string }[];
  currentUserId: string;
  currentUsername: string;
  initialItems: WishlistItemRow[];
  initialProfiles: Record<string, string>;
}) {
  const [items, setItems] = useState<WishlistItemRow[]>(initialItems);
  const [profiles, setProfiles] = useState<Record<string, string>>(initialProfiles);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fetchingProfiles = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missingIds = new Set<string>();
    for (const item of items) {
      if (!profiles[item.added_by]) missingIds.add(item.added_by);
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

    // Same table as the main shopping list (is_wishlist = true), so — same
    // caution as shopping-list.tsx — filtering happens client-side, not via
    // a second Realtime filter clause.
    const handleInsert = (payload: RealtimePostgresInsertPayload<WishlistItemRow>) => {
      const row = payload.new;
      if (!row.is_wishlist) return;
      setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [...prev, row]));
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<WishlistItemRow>) => {
      const row = payload.new;
      if (!row.is_wishlist) {
        // Moved to the shopping list — no longer belongs here.
        setItems((prev) => prev.filter((i) => i.id !== row.id));
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === row.id ? row : i)));
    };

    const handleDelete = (payload: RealtimePostgresDeletePayload<WishlistItemRow>) => {
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

      let ch: RealtimeChannel = supabase.channel(`wishlist-items-changes-${groupId}`);
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
      // No filter on DELETE — without REPLICA IDENTITY FULL a delete's
      // "old" row only carries the primary key, so a group_id filter would
      // never match. handleDelete filters by id against already-loaded
      // items instead, matching the pattern in shopping-list.tsx.
      ch = ch.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "shopping_items" },
        handleDelete
      );
      ch.subscribe();

      channel = ch;
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [groupId]);

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
      .catch(() => {});
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
        is_wishlist: true,
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

  async function handleMoveToShopping(id: number) {
    const supabase = createClient();
    await supabase.from("shopping_items").update({ is_wishlist: false }).eq("id", id);
  }

  async function handleDeleteItem(id: number) {
    const supabase = createClient();
    await supabase.from("shopping_items").delete().eq("id", id);
  }

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-black">
      <GroupHeader
        groupId={groupId}
        groups={groups}
        activeTab="wishlist"
        subtitle={
          <span className="text-xs text-zinc-500">
            {items.length} פריטים ברשימת המשאלות
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-1">
        {items.length === 0 && (
          <p className="text-center text-sm text-zinc-400 mt-8">
            ריק — הוסיפו כאן דברים שראיתם בסופר ולא דחוף לקנות עכשיו.
          </p>
        )}

        {items.map((item) => {
          const addedByName = profiles[item.added_by] ?? "משתמש";
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm">{item.name}</span>
                  {item.quantity && (
                    <span className="text-xs text-zinc-400">×{item.quantity}</span>
                  )}
                  {item.estimated_price != null && (
                    <span className="text-xs text-zinc-400">
                      ~{Number(item.estimated_price).toFixed(0)} ₪
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-400">{`נוסף ע"י ${addedByName}`}</span>
              </div>
              <button
                onClick={() => handleMoveToShopping(item.id)}
                className="shrink-0 rounded-full bg-foreground text-background px-3 py-1.5 text-xs font-medium whitespace-nowrap"
              >
                עברתי לקנייה
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

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-2 border-t border-black/10 dark:border-white/10 p-3"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="הוספה לרשימת המשאלות... (למשל: פודינג חדש)"
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
