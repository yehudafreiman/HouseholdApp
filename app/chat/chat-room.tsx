"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Message = {
  id: number;
  content: string;
  created_at: string;
  user_id: string;
  username: string;
};

export default function ChatRoom({
  currentUserId,
  currentUsername,
  initialMessages,
}: {
  currentUserId: string;
  currentUsername: string;
  initialMessages: Message[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const usernameCache = useRef<Map<string, string>>(
    new Map(initialMessages.map((m) => [m.user_id, m.username]))
  );

  useEffect(() => {
    usernameCache.current.set(currentUserId, currentUsername);
  }, [currentUserId, currentUsername]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const supabase = createClient();

    const handleInsert: (payload: {
      new: { id: number; content: string; created_at: string; user_id: string };
    }) => void = async (payload) => {
      const row = payload.new;

      const cached = usernameCache.current.get(row.user_id);
      let username: string;
      if (cached) {
        username = cached;
      } else {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", row.user_id)
          .single();
        username = profile?.username ?? "משתמש";
        usernameCache.current.set(row.user_id, username);
      }

      setMessages((prev) =>
        prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, username }]
      );
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // The realtime socket needs the user's access token explicitly — the
    // browser client doesn't wire this up on its own, and without it
    // postgres_changes events are rejected by the messages RLS policy.
    // This must be awaited before subscribing, otherwise events that
    // arrive right after mount race the token handshake and get dropped.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;

      channel = supabase
        .channel("messages-changes")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          handleInsert
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("messages")
      .insert({ user_id: currentUserId, content: trimmed });

    if (!error) {
      setContent("");
    }
    setSending(false);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-4 py-3">
        <span className="text-sm text-zinc-500">
          מחובר/ת בתור <span className="font-medium text-foreground">{currentUsername}</span>
        </span>
        <button
          onClick={handleSignOut}
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          התנתקות
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.map((m) => {
          const isMine = m.user_id === currentUserId;
          return (
            <div
              key={m.id}
              className={`flex flex-col max-w-[75%] ${isMine ? "self-end items-end" : "self-start items-start"}`}
            >
              {!isMine && (
                <span className="text-xs text-zinc-500 mb-1">{m.username}</span>
              )}
              <div
                className={`rounded-2xl px-4 py-2 text-sm ${
                  isMine
                    ? "bg-foreground text-background"
                    : "bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10"
                }`}
              >
                {m.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-black/10 dark:border-white/10 p-3"
      >
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="הקלד/י הודעה..."
          className="flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
        />
        <button
          type="submit"
          disabled={sending || !content.trim()}
          className="rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          שליחה
        </button>
      </form>
    </div>
  );
}
