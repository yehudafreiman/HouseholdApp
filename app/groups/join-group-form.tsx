"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinGroupForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("join_group_by_code", { p_code: trimmed });

    if (error || !data) {
      setError("קוד הזמנה לא תקין");
      setSubmitting(false);
      return;
    }

    router.push(`/groups/${data}/shopping`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label className="text-sm font-medium">הצטרפות לקבוצה עם קוד הזמנה</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="קוד הזמנה"
          className="min-w-0 flex-1 rounded-full bg-white dark:bg-zinc-900 shadow-inset px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
        />
        <button
          type="submit"
          disabled={submitting || !code.trim()}
          className="shrink-0 rounded-full bg-accent text-accent-foreground px-5 py-2 text-sm font-medium shadow-raised transition hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
        >
          הצטרפות
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
