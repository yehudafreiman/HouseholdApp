"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function CreateGroupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_group", { p_name: trimmed });

    if (error || !data) {
      setError("שגיאה ביצירת הקבוצה, נסה/י שוב");
      setSubmitting(false);
      return;
    }

    router.push(`/groups/${data}/chat`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label className="text-sm font-medium">קבוצה חדשה</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם הקבוצה (למשל: המשפחה שלנו)"
          className="min-w-0 flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
        />
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="shrink-0 rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          יצירה
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
