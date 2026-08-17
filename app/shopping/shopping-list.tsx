"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_GROUP_ID, SHOPPING_CATEGORIES } from "@/lib/shopping";

type ShoppingItemRow = {
  id: number;
  name: string;
  category: string | null;
  quantity: string | null;
  estimated_price: number | null;
  is_checked: boolean;
  added_by: string;
  checked_by: string | null;
  checked_at: string | null;
  created_at: string;
};

function sortItems(list: ShoppingItemRow[]) {
  return [...list].sort((a, b) => {
    if (a.is_checked !== b.is_checked) return a.is_checked ? 1 : -1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export default function ShoppingList({
  currentUserId,
  currentUsername,
  initialItems,
  initialProfiles,
}: {
  currentUserId: string;
  currentUsername: string;
  initialItems: ShoppingItemRow[];
  initialProfiles: Record<string, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ShoppingItemRow[]>(initialItems);
  const [profiles, setProfiles] = useState<Record<string, string>>(initialProfiles);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
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

    const handleInsert = (payload: RealtimePostgresInsertPayload<ShoppingItemRow>) => {
      const row = payload.new;
      setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [...prev, row]));
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<ShoppingItemRow>) => {
      const row = payload.new;
      setItems((prev) => prev.map((i) => (i.id === row.id ? row : i)));
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

      let ch: RealtimeChannel = supabase.channel("shopping-items-changes");
      ch = ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shopping_items" },
        handleInsert
      );
      ch = ch.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "shopping_items" },
        handleUpdate
      );
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
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setCategorizing(true);

    let category = "אחר";
    try {
      const res = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const data = (await res.json()) as { category?: string };
        if (data.category) category = data.category;
      }
    } catch {
      // network error — fall back to "אחר"
    }
    setCategorizing(false);

    const supabase = createClient();
    const trimmedQuantity = quantity.trim();
    const trimmedPrice = price.trim();
    const { error } = await supabase.from("shopping_items").insert({
      group_id: DEFAULT_GROUP_ID,
      name: trimmed,
      category,
      quantity: trimmedQuantity || null,
      estimated_price: trimmedPrice ? Number(trimmedPrice) : null,
      added_by: currentUserId,
    });

    if (!error) {
      setName("");
      setQuantity("");
      setPrice("");
    }
    setSubmitting(false);
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
    }
  }

  async function handleDeleteItem(id: number) {
    const supabase = createClient();
    await supabase.from("shopping_items").delete().eq("id", id);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
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
  const totalEstimated = items
    .filter((i) => !i.is_checked && i.estimated_price != null)
    .reduce((sum, i) => sum + Number(i.estimated_price), 0);

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium">רשימת קניות</span>
          <span className="text-xs text-zinc-500">
            {uncheckedCount} פריטים לקנייה
            {totalEstimated > 0 && ` · כ-${totalEstimated.toFixed(0)} ₪`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/chat"
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            aria-label="חזרה לצ'אט"
          >
            💬
          </Link>
          <button
            onClick={handleSignOut}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            התנתקות
          </button>
        </div>
      </header>

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
                    className={`flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-2 ${
                      item.is_checked ? "opacity-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.is_checked}
                      onChange={() => toggleChecked(item)}
                      className="h-4 w-4 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
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
                      </div>
                      <span className="text-[10px] text-zinc-400">
                        {item.is_checked
                          ? `נקנה ע"י ${checkedByName ?? "משתמש"}`
                          : `נוסף ע"י ${addedByName}`}
                      </span>
                    </div>
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
            className="flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <input
            type="text"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="כמות"
            className="w-20 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="מחיר ₪"
            className="w-24 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {categorizing ? "מקטלג..." : "הוספה"}
          </button>
        </div>
        <span className="text-[11px] text-zinc-500 px-2">
          מחובר/ת בתור {currentUsername}
        </span>
      </form>
    </div>
  );
}
