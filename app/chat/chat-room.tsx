"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type MessageRow = {
  id: number;
  content: string;
  created_at: string;
  updated_at: string;
  user_id: string;
};

type ReactionRow = {
  id: number;
  message_id: number;
  user_id: string;
  emoji: string;
};

type Reaction = { id: number; emoji: string; user_id: string; username: string };

type Message = MessageRow & { username: string; reactions: Reaction[] };

const TYPING_TIMEOUT_MS = 3000;
const TYPING_BROADCAST_INTERVAL_MS = 1500;
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"];

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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [onlineUsers, setOnlineUsers] = useState<Map<string, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const usernameCache = useRef<Map<string, string>>(
    new Map(initialMessages.map((m) => [m.user_id, m.username]))
  );
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const lastTypingSentRef = useRef(0);

  useEffect(() => {
    usernameCache.current.set(currentUserId, currentUsername);
  }, [currentUserId, currentUsername]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const supabase = createClient();
    const typingTimeouts = typingTimeoutsRef.current;

    async function resolveUsername(userId: string) {
      const cached = usernameCache.current.get(userId);
      if (cached) return cached;

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .single();
      const username = profile?.username ?? "משתמש";
      usernameCache.current.set(userId, username);
      return username;
    }

    const handleInsert = async (
      payload: RealtimePostgresInsertPayload<MessageRow>
    ) => {
      const row = payload.new;
      const username = await resolveUsername(row.user_id);

      setMessages((prev) =>
        prev.some((m) => m.id === row.id)
          ? prev
          : [...prev, { ...row, username, reactions: [] }]
      );

      setTypingUsers((prev) => {
        if (!prev.has(row.user_id)) return prev;
        const next = new Map(prev);
        next.delete(row.user_id);
        return next;
      });
    };

    const handleUpdate = async (
      payload: RealtimePostgresUpdatePayload<MessageRow>
    ) => {
      const row = payload.new;
      const username = await resolveUsername(row.user_id);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === row.id ? { ...row, username, reactions: m.reactions } : m
        )
      );
    };

    const handleDelete = (payload: RealtimePostgresDeletePayload<MessageRow>) => {
      const deletedId = payload.old.id;
      if (deletedId === undefined) return;
      setMessages((prev) => prev.filter((m) => m.id !== deletedId));
    };

    const handleReactionInsert = async (
      payload: RealtimePostgresInsertPayload<ReactionRow>
    ) => {
      const row = payload.new;
      const username = await resolveUsername(row.user_id);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === row.message_id && !m.reactions.some((r) => r.id === row.id)
            ? {
                ...m,
                reactions: [
                  ...m.reactions,
                  { id: row.id, emoji: row.emoji, user_id: row.user_id, username },
                ],
              }
            : m
        )
      );
    };

    const handleReactionDelete = (
      payload: RealtimePostgresDeletePayload<ReactionRow>
    ) => {
      const deletedId = payload.old.id;
      if (deletedId === undefined) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.reactions.some((r) => r.id === deletedId)
            ? { ...m, reactions: m.reactions.filter((r) => r.id !== deletedId) }
            : m
        )
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

      // Each `.on()` call is assigned separately (rather than chained) —
      // chaining several different event-type overloads back to back
      // confuses TS's overload resolution for this client. `ch` is typed
      // explicitly so each call resolves against the full overload set
      // instead of the previous call's narrowed return type.
      let ch: RealtimeChannel = supabase.channel("messages-changes", {
        config: { presence: { key: currentUserId } },
      });
      ch = ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        handleInsert
      );
      ch = ch.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        handleUpdate
      );
      ch = ch.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        handleDelete
      );
      ch = ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        handleReactionInsert
      );
      ch = ch.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        handleReactionDelete
      );
      ch = ch.on("broadcast", { event: "typing" }, ({ payload }) => {
        const { user_id, username } = payload as {
          user_id: string;
          username: string;
        };
        if (user_id === currentUserId) return;

        setTypingUsers((prev) => new Map(prev).set(user_id, username));

        const existingTimeout = typingTimeouts.get(user_id);
        if (existingTimeout) clearTimeout(existingTimeout);
        typingTimeouts.set(
          user_id,
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Map(prev);
              next.delete(user_id);
              return next;
            });
            typingTimeouts.delete(user_id);
          }, TYPING_TIMEOUT_MS)
        );
      });
      ch = ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<{ username: string }>();
        const next = new Map<string, string>();
        for (const [userId, presences] of Object.entries(state)) {
          if (presences[0]) next.set(userId, presences[0].username);
        }
        setOnlineUsers(next);
      });
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ username: currentUsername });
        }
      });

      channel = ch;
      channelRef.current = channel;
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      typingTimeouts.forEach((t) => clearTimeout(t));
      typingTimeouts.clear();
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [currentUserId, currentUsername]);

  function notifyTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_BROADCAST_INTERVAL_MS) return;
    lastTypingSentRef.current = now;

    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: currentUserId, username: currentUsername },
    });
  }

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

  function startEdit(m: Message) {
    setEditingId(m.id);
    setEditContent(m.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

  async function saveEdit(id: number) {
    const trimmed = editContent.trim();
    if (!trimmed) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("messages")
      .update({ content: trimmed, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", currentUserId);

    if (!error) {
      cancelEdit();
    }
  }

  async function handleDeleteMessage(id: number) {
    const supabase = createClient();
    await supabase.from("messages").delete().eq("id", id).eq("user_id", currentUserId);
  }

  async function toggleReaction(message: Message, emoji: string) {
    const supabase = createClient();
    const existing = message.reactions.find(
      (r) => r.emoji === emoji && r.user_id === currentUserId
    );

    if (existing) {
      await supabase.from("message_reactions").delete().eq("id", existing.id);
    } else {
      await supabase
        .from("message_reactions")
        .insert({ message_id: message.id, user_id: currentUserId, emoji });
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const typingLabel =
    typingUsers.size === 0
      ? null
      : typingUsers.size === 1
        ? `${[...typingUsers.values()][0]} מקליד/ה...`
        : `${[...typingUsers.values()].join(", ")} מקלידים...`;

  const onlineOthers = [...onlineUsers.entries()]
    .filter(([userId]) => userId !== currentUserId)
    .map(([, username]) => username);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm text-zinc-500">
            מחובר/ת בתור <span className="font-medium text-foreground">{currentUsername}</span>
          </span>
          {onlineOthers.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-zinc-400 mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              {onlineOthers.join(", ")} מחובר/ים כרגע
            </span>
          )}
        </div>
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
          const isEditing = editingId === m.id;
          const wasEdited = m.updated_at !== m.created_at;

          const reactionGroups = new Map<string, Reaction[]>();
          for (const r of m.reactions) {
            const group = reactionGroups.get(r.emoji) ?? [];
            group.push(r);
            reactionGroups.set(r.emoji, group);
          }

          return (
            <div
              key={m.id}
              className={`group flex flex-col max-w-[75%] ${isMine ? "self-end items-end" : "self-start items-start"}`}
            >
              {!isMine && (
                <span className="flex items-center gap-1 text-xs text-zinc-500 mb-1">
                  {onlineUsers.has(m.user_id) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                  {m.username}
                </span>
              )}

              {isEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    autoFocus
                    className="rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
                  />
                  <button
                    onClick={() => saveEdit(m.id)}
                    className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    שמירה
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    ביטול
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {isMine && (
                    <span className="hidden group-hover:flex items-center gap-2 text-xs text-zinc-500">
                      <button
                        onClick={() => startEdit(m)}
                        className="hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        עריכה
                      </button>
                      <button
                        onClick={() => handleDeleteMessage(m.id)}
                        className="hover:text-red-600"
                      >
                        מחיקה
                      </button>
                    </span>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-2 text-sm ${
                      isMine
                        ? "bg-foreground text-background"
                        : "bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10"
                    }`}
                  >
                    {m.content}
                    {wasEdited && (
                      <span
                        className={`text-[10px] mr-2 ${isMine ? "opacity-70" : "text-zinc-400"}`}
                      >
                        נערך
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {[...reactionGroups.entries()].map(([emoji, reactors]) => {
                  const iReacted = reactors.some((r) => r.user_id === currentUserId);
                  return (
                    <button
                      key={emoji}
                      onClick={() => toggleReaction(m, emoji)}
                      title={reactors.map((r) => r.username).join(", ")}
                      className={`text-xs rounded-full px-2 py-0.5 border ${
                        iReacted
                          ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950"
                          : "border-black/10 dark:border-white/10"
                      }`}
                    >
                      {emoji} {reactors.length}
                    </button>
                  );
                })}
                <span className="hidden group-hover:flex items-center gap-1">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => toggleReaction(m, emoji)}
                      className="text-xs opacity-50 hover:opacity-100"
                    >
                      {emoji}
                    </button>
                  ))}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {typingLabel && (
        <div className="px-4 pb-1 text-xs text-zinc-500">{typingLabel}</div>
      )}

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-black/10 dark:border-white/10 p-3"
      >
        <input
          type="text"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            notifyTyping();
          }}
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
