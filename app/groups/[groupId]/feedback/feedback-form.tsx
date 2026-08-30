"use client";

import { useState } from "react";
import Link from "next/link";
import { BugIcon, LightbulbIcon } from "@/components/icons";

const FEEDBACK_EMAIL = "YehFre@icloud.com";

export default function FeedbackForm({
  groupId,
  senderLabel,
  groupName,
}: {
  groupId: string;
  senderLabel: string;
  groupName: string;
}) {
  const [kind, setKind] = useState<"bug" | "idea">("bug");
  const [text, setText] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    const subject = kind === "bug" ? "דיווח על בעיה באפליקציה" : "הצעה לשיפור באפליקציה";
    const body = [
      `מאת: ${senderLabel}`,
      `קבוצה: ${groupName}`,
      "",
      trimmed,
    ].join("\n");

    // No storage/backend for this on purpose — it just hands off to the
    // sender's own mail app, so nothing here needs auth beyond the page
    // guard, and there's nothing new to keep secure.
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-black px-4">
      <h1 className="text-lg font-semibold">דיווח על בעיה / הצעה לשיפור</h1>
      <p className="text-sm text-zinc-500 text-center max-w-sm">
        זה נשלח כמייל ישירות למפתח האפליקציה — לא נשמר כאן ולא נראה לחברי הקבוצה.
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-3">
        <div className="flex rounded-full bg-white dark:bg-zinc-900 shadow-inset overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setKind("bug")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2 transition active:scale-95 ${kind === "bug" ? "bg-accent text-accent-foreground" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
          >
            <BugIcon className="h-4 w-4" /> באג
          </button>
          <button
            type="button"
            onClick={() => setKind("idea")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2 transition active:scale-95 ${kind === "idea" ? "bg-accent text-accent-foreground" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
          >
            <LightbulbIcon className="h-4 w-4" /> הצעה
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={kind === "bug" ? "מה קרה? מה ציפית שיקרה?" : "מה היית רוצה שיהיה?"}
          className="rounded-lg bg-white dark:bg-zinc-900 shadow-inset px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 resize-none"
        />

        <button
          type="submit"
          disabled={!text.trim()}
          className="rounded-full bg-accent text-accent-foreground px-5 py-2 text-sm font-medium shadow-raised transition hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
        >
          שליחה במייל
        </button>
      </form>

      <Link
        href={`/groups/${groupId}/chat`}
        className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 mt-2"
      >
        חזרה לצ&apos;אט
      </Link>
    </div>
  );
}
