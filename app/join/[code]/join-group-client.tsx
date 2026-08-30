"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinGroupClient({ code }: { code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    supabase.rpc("join_group_by_code", { p_code: code }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setError("קוד ההזמנה לא תקין");
        return;
      }
      router.push(`/groups/${data}/shopping`);
      router.refresh();
    });

    return () => {
      cancelled = true;
    };
  }, [code, router]);

  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-50 dark:bg-black px-4">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-red-600 mb-4">{error}</p>
            <a
              href="/groups"
              className="text-sm text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-300"
            >
              חזרה לקבוצות שלי
            </a>
          </>
        ) : (
          <p className="text-sm text-zinc-500">מצטרפ/ת לקבוצה...</p>
        )}
      </div>
    </div>
  );
}
