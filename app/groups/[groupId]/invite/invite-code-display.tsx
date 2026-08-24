"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function InviteCodeDisplay({
  groupId,
  groupName,
  inviteCode,
  isOwner,
}: {
  groupId: string;
  groupName: string;
  inviteCode: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(inviteCode);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    const link = `${window.location.origin}/join/${code}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    const newCode = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const supabase = createClient();
    const { error } = await supabase
      .from("groups")
      .update({ invite_code: newCode })
      .eq("id", groupId);

    if (error) {
      setError("שגיאה ביצירת קוד חדש, נסה/י שוב");
    } else {
      setCode(newCode);
    }
    setRegenerating(false);
  }

  async function handleDeleteGroup() {
    const confirmed = window.confirm(
      `למחוק את הקבוצה "${groupName}" לצמיתות? כל הצ'אט ורשימת הקניות שלה יימחקו ולא ניתן לשחזר.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("groups").delete().eq("id", groupId);

    if (error) {
      setError("שגיאה במחיקת הקבוצה, נסה/י שוב");
      setDeleting(false);
    } else {
      router.push("/groups");
      router.refresh();
    }
  }

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-black px-4">
      <h1 className="text-lg font-semibold">הזמנה ל{groupName}</h1>
      <p className="text-sm text-zinc-500 text-center max-w-sm">
        שלח/י את הקוד או הקישור למי שתרצה/י להוסיף לקבוצה
      </p>
      <div className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-6 py-3 text-lg font-mono tracking-widest">
        {code}
      </div>
      <button
        onClick={handleCopy}
        className="rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium"
      >
        {copied ? "הועתק!" : "העתקת קישור הצטרפות"}
      </button>
      {isOwner && (
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="text-xs text-zinc-500 underline disabled:opacity-50"
        >
          יצירת קוד חדש (מבטל את הקוד הישן)
        </button>
      )}
      {isOwner && (
        <button
          onClick={handleDeleteGroup}
          disabled={deleting}
          className="text-xs text-red-600 underline disabled:opacity-50"
        >
          מחיקת הקבוצה לצמיתות
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Link href={`/groups/${groupId}/chat`} className="text-sm text-zinc-500 mt-4">
        חזרה לצ&apos;אט
      </Link>
    </div>
  );
}
