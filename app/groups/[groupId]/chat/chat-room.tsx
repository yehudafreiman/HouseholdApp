"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  RealtimePostgresDeletePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useGroupMeta, type GroupMeta } from "@/lib/hooks/use-group-meta";
import GroupHeader from "@/components/group-header";

type MessageRow = {
  id: number;
  content: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
};

type ReactionRow = {
  id: number;
  message_id: number;
  user_id: string;
  emoji: string;
};

type Reaction = { id: number; emoji: string; user_id: string; username: string };

type Message = MessageRow & { username: string; reactions: Reaction[] };

type PresenceInfo = { username: string; lastRead: number };

const TYPING_TIMEOUT_MS = 3000;
const TYPING_BROADCAST_INTERVAL_MS = 1500;
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"];
const ATTACHMENTS_BUCKET = "chat-attachments";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

const MESSAGES_KEY = (groupId: string) => ["chat-messages", groupId] as const;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileEmoji(mimeType: string) {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎥";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType === "application/pdf") return "📄";
  return "📎";
}

function sanitizeFilename(name: string) {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
}

async function fetchMessages(groupId: string): Promise<Message[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("messages")
    .select(
      "id, content, created_at, updated_at, user_id, attachment_path, attachment_name, attachment_type, attachment_size, profiles(username), message_reactions(id, emoji, user_id, profiles(username))"
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(100);

  return (data ?? []).map((m) => ({
    id: m.id,
    content: m.content,
    created_at: m.created_at,
    updated_at: m.updated_at,
    user_id: m.user_id,
    attachment_path: m.attachment_path,
    attachment_name: m.attachment_name,
    attachment_type: m.attachment_type,
    attachment_size: m.attachment_size,
    // Supabase returns the joined row as an object here since it's a to-one relationship
    username: (m.profiles as unknown as { username: string } | null)?.username ?? "משתמש",
    reactions: (
      (m.message_reactions ?? []) as unknown as {
        id: number;
        emoji: string;
        user_id: string;
        profiles: { username: string } | null;
      }[]
    ).map((r) => ({
      id: r.id,
      emoji: r.emoji,
      user_id: r.user_id,
      username: r.profiles?.username ?? "משתמש",
    })),
  }));
}

export default function ChatRoom({
  groupId,
  currentUserId,
  currentUserEmail,
}: {
  groupId: string;
  currentUserId: string;
  currentUserEmail: string | null;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  // Which message's action row (edit/delete/react) is expanded — hover
  // reveals it on desktop, but touch devices have no hover, so tapping the
  // "⋯" button toggles this instead.
  const [activeMessageId, setActiveMessageId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [onlineUsers, setOnlineUsers] = useState<Map<string, PresenceInfo>>(new Map());
  const [unreadCount, setUnreadCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const lastTypingSentRef = useRef(0);

  const { data: meta } = useGroupMeta(currentUserId, currentUserEmail);
  const groups = meta?.groups ?? [];
  const currentUsername = meta?.currentUsername ?? currentUserEmail ?? "אני";

  const { data: messagesData, isPending: messagesPending } = useQuery({
    queryKey: MESSAGES_KEY(groupId),
    queryFn: () => fetchMessages(groupId),
  });
  const messages = useMemo(() => messagesData ?? [], [messagesData]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  // Track whether the user is scrolled near the bottom, in a ref rather
  // than state — it's only read inside the realtime INSERT handler below
  // (to decide "auto-scroll" vs "show unread badge"), not during render.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearBottom = distanceFromBottom < 80;
      isNearBottomRef.current = nearBottom;
      if (nearBottom) setUnreadCount(0);
    }

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnreadCount(0);
  }

  useEffect(() => {
    const supabase = createClient();
    const typingTimeouts = typingTimeoutsRef.current;

    // group-meta already holds every profile's username, so resolving one
    // here is a synchronous cache read instead of a per-message query.
    function resolveUsername(userId: string) {
      const meta = queryClient.getQueryData<GroupMeta>(["group-meta", currentUserId]);
      return meta?.profileMap[userId] ?? "משתמש";
    }

    const handleInsert = (payload: RealtimePostgresInsertPayload<MessageRow>) => {
      const row = payload.new;
      const username = resolveUsername(row.user_id);

      let wasAdded = false;
      queryClient.setQueryData<Message[]>(MESSAGES_KEY(groupId), (prev) => {
        const list = prev ?? [];
        if (list.some((m) => m.id === row.id)) return list;
        wasAdded = true;
        return [...list, { ...row, username, reactions: [] }];
      });

      if (wasAdded) {
        if (isNearBottomRef.current) {
          // Wait a tick for the new message to actually render before
          // scrolling to it.
          requestAnimationFrame(() =>
            bottomRef.current?.scrollIntoView({ behavior: "smooth" })
          );
        } else {
          setUnreadCount((c) => c + 1);
        }
      }

      setTypingUsers((prev) => {
        if (!prev.has(row.user_id)) return prev;
        const next = new Map(prev);
        next.delete(row.user_id);
        return next;
      });
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<MessageRow>) => {
      const row = payload.new;
      const username = resolveUsername(row.user_id);

      queryClient.setQueryData<Message[]>(MESSAGES_KEY(groupId), (prev) =>
        (prev ?? []).map((m) =>
          m.id === row.id ? { ...row, username, reactions: m.reactions } : m
        )
      );
    };

    const handleDelete = (payload: RealtimePostgresDeletePayload<MessageRow>) => {
      const deletedId = payload.old.id;
      if (deletedId === undefined) return;
      queryClient.setQueryData<Message[]>(MESSAGES_KEY(groupId), (prev) =>
        (prev ?? []).filter((m) => m.id !== deletedId)
      );
    };

    const handleReactionInsert = (payload: RealtimePostgresInsertPayload<ReactionRow>) => {
      const row = payload.new;
      const username = resolveUsername(row.user_id);

      queryClient.setQueryData<Message[]>(MESSAGES_KEY(groupId), (prev) =>
        (prev ?? []).map((m) =>
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
      queryClient.setQueryData<Message[]>(MESSAGES_KEY(groupId), (prev) =>
        (prev ?? []).map((m) =>
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

      // Channel name and presence pool are per-group — presence/broadcast
      // have no RLS at all, so without a per-group channel name one
      // group's "typing"/"online" would leak into another group's chat.
      //
      // Each `.on()` call is assigned separately (rather than chained) —
      // chaining several different event-type overloads back to back
      // confuses TS's overload resolution for this client. `ch` is typed
      // explicitly so each call resolves against the full overload set
      // instead of the previous call's narrowed return type.
      let ch: RealtimeChannel = supabase.channel(`messages-changes-${groupId}`, {
        config: { presence: { key: currentUserId } },
      });
      ch = ch.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        handleInsert
      );
      ch = ch.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        },
        handleUpdate
      );
      // No filter on DELETE: without REPLICA IDENTITY FULL, a delete's
      // "old" row only carries the primary key, not group_id — a filter
      // referencing group_id would never match and Realtime would drop
      // every delete event silently. handleDelete only matches by id
      // against the current group's already-loaded messages, so an
      // unfiltered delete from another group is a harmless no-op locally.
      ch = ch.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        handleDelete
      );
      // message_reactions has no group_id column of its own (it's a pure
      // child row of messages), so it can't take a filter clause here —
      // RLS (scoped via a join through messages) is what actually keeps
      // another group's reactions out.
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
        const state = ch.presenceState<{ username: string; lastRead?: number }>();
        const next = new Map<string, PresenceInfo>();
        for (const [userId, presences] of Object.entries(state)) {
          if (presences[0]) {
            next.set(userId, {
              username: presences[0].username,
              lastRead: presences[0].lastRead ?? 0,
            });
          }
        }
        setOnlineUsers(next);
      });
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ username: currentUsername, lastRead: 0 });
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
  }, [groupId, currentUserId, currentUsername, queryClient]);

  // Mark the latest message as read (via presence) whenever the message
  // list changes — but only while the tab is actually focused. Without the
  // focus check, "read" would just mean "the browser has the data", not
  // "someone looked at it" (e.g. a backgrounded tab would still show as
  // read). Also re-checks on focus/visibility change, since messages can
  // arrive while backgrounded and should be marked read once you return.
  useEffect(() => {
    function markRead() {
      if (!document.hasFocus() || messages.length === 0 || !channelRef.current) {
        return;
      }
      const lastId = messages[messages.length - 1].id;
      channelRef.current
        .track({ username: currentUsername, lastRead: lastId })
        .catch(() => {});
    }

    markRead();
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);

    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [messages, currentUsername]);

  // Attachments live in a private bucket, so displaying/downloading one
  // needs a signed URL. Resolve only the paths not already cached whenever
  // the message list changes (initial load or new realtime messages).
  useEffect(() => {
    const paths = [
      ...new Set(
        messages
          .map((m) => m.attachment_path)
          .filter((p): p is string => !!p && !signedUrls.has(p))
      ),
    ];
    if (paths.length === 0) return;

    const supabase = createClient();
    supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
      .then(({ data }) => {
        if (!data) return;
        setSignedUrls((prev) => {
          const next = new Map(prev);
          for (const entry of data) {
            if (entry.path && entry.signedUrl) next.set(entry.path, entry.signedUrl);
          }
          return next;
        });
      });
  }, [messages, signedUrls]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadError(null);

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadError("הקובץ גדול מדי (מקסימום 25MB)");
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const path = `${groupId}/${currentUserId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;

    const { error: uploadErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file);

    if (uploadErr) {
      setUploadError("שגיאה בהעלאת הקובץ, נסה/י שוב");
      setUploading(false);
      return;
    }

    const { error: insertErr } = await supabase.from("messages").insert({
      user_id: currentUserId,
      content: content.trim(),
      group_id: groupId,
      attachment_path: path,
      attachment_name: file.name,
      attachment_type: file.type || "application/octet-stream",
      attachment_size: file.size,
    });

    if (insertErr) {
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path]);
      setUploadError("שגיאה בשליחת הקובץ, נסה/י שוב");
    } else {
      setContent("");
    }
    setUploading(false);
  }

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
      .insert({ user_id: currentUserId, content: trimmed, group_id: groupId });

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
    const message = messages.find((m) => m.id === id);
    const supabase = createClient();
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", id)
      .eq("user_id", currentUserId);

    if (!error && message?.attachment_path) {
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([message.attachment_path]);
    }
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

  const typingLabel =
    typingUsers.size === 0
      ? null
      : typingUsers.size === 1
        ? `${[...typingUsers.values()][0]} מקליד/ה...`
        : `${[...typingUsers.values()].join(", ")} מקלידים...`;

  const onlineOthers = [...onlineUsers.entries()]
    .filter(([userId]) => userId !== currentUserId)
    .map(([, info]) => info.username);

  const trimmedQuery = searchQuery.trim();
  const filteredMessages = trimmedQuery
    ? messages.filter((m) =>
        m.content.toLowerCase().includes(trimmedQuery.toLowerCase())
      )
    : messages;

  function highlightMatch(text: string) {
    if (!trimmedQuery) return text;
    const idx = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-300 dark:bg-yellow-600 dark:text-black rounded px-0.5">
          {text.slice(idx, idx + trimmedQuery.length)}
        </mark>
        {text.slice(idx + trimmedQuery.length)}
      </>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-black">
      <GroupHeader
        groupId={groupId}
        groups={groups}
        activeTab="chat"
        extraActions={
          <button
            onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setSearchQuery("");
            }}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            aria-label="חיפוש בהודעות"
          >
            🔍
          </button>
        }
        subtitle={
          <>
            <span className="text-xs text-zinc-500">
              מחובר/ת בתור <span className="font-medium text-foreground">{currentUsername}</span>
            </span>
            {onlineOthers.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-zinc-400 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                {onlineOthers.join(", ")} מחובר/ים כרגע
              </span>
            )}
          </>
        }
      />

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-black/10 dark:border-white/10 px-4 py-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            placeholder="חיפוש בהודעות..."
            className="flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
          />
          {trimmedQuery && (
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              {filteredMessages.length} תוצאות
            </span>
          )}
          <button
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3"
      >
        {messagesPending ? (
          <div className="flex flex-col gap-3 animate-pulse" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-9 max-w-[65%] rounded-2xl bg-zinc-200 dark:bg-zinc-800 ${
                  i % 2 === 0 ? "self-start w-40" : "self-end w-52"
                }`}
              />
            ))}
          </div>
        ) : (
          filteredMessages.map((m) => {
          const isMine = m.user_id === currentUserId;
          const isEditing = editingId === m.id;
          const isActive = activeMessageId === m.id;
          const wasEdited = m.updated_at !== m.created_at;

          const reactionGroups = new Map<string, Reaction[]>();
          for (const r of m.reactions) {
            const group = reactionGroups.get(r.emoji) ?? [];
            group.push(r);
            reactionGroups.set(r.emoji, group);
          }

          const readers = isMine
            ? [...onlineUsers.entries()]
                .filter(([userId, info]) => userId !== currentUserId && info.lastRead >= m.id)
                .map(([, info]) => info.username)
            : [];

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
                    <span
                      className={`${isActive ? "flex" : "hidden group-hover:flex"} items-center gap-2 text-xs text-zinc-500`}
                    >
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
                  <button
                    onClick={() => setActiveMessageId(isActive ? null : m.id)}
                    className="text-xs text-zinc-400 opacity-60 hover:opacity-100 px-1"
                    aria-label="פעולות נוספות"
                  >
                    ⋯
                  </button>
                  <div
                    className={`rounded-2xl px-4 py-2 text-sm ${
                      isMine
                        ? "bg-foreground text-background"
                        : "bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10"
                    }`}
                  >
                    {m.attachment_path && (
                      <a
                        href={signedUrls.get(m.attachment_path) ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block ${m.content ? "mb-2" : ""}`}
                      >
                        {m.attachment_type?.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={signedUrls.get(m.attachment_path)}
                            alt={m.attachment_name ?? ""}
                            className="max-h-64 max-w-full rounded-lg object-contain"
                          />
                        ) : (
                          <span
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                              isMine
                                ? "border-background/20"
                                : "border-black/10 dark:border-white/10"
                            }`}
                          >
                            <span>{fileEmoji(m.attachment_type ?? "")}</span>
                            <span className="flex flex-col">
                              <span className="text-xs font-medium truncate max-w-[12rem]">
                                {m.attachment_name}
                              </span>
                              {m.attachment_size !== null && (
                                <span
                                  className={`text-[10px] ${isMine ? "opacity-70" : "text-zinc-400"}`}
                                >
                                  {formatFileSize(m.attachment_size)}
                                </span>
                              )}
                            </span>
                          </span>
                        )}
                      </a>
                    )}
                    {m.content && highlightMatch(m.content)}
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
                <span
                  className={`${isActive ? "flex" : "hidden group-hover:flex"} items-center gap-1`}
                >
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

              {readers.length > 0 && (
                <span
                  className="text-[10px] text-blue-500 mt-0.5"
                  title={readers.join(", ")}
                >
                  נקרא ✓✓
                </span>
              )}
            </div>
          );
        })
        )}
        <div ref={bottomRef} />
      </div>

      {unreadCount > 0 && (
        <div className="flex justify-center pb-1">
          <button
            onClick={scrollToBottom}
            className="rounded-full bg-foreground text-background text-xs px-4 py-1.5 shadow"
          >
            ↓ {unreadCount} הודעות חדשות
          </button>
        </div>
      )}

      {typingLabel && (
        <div className="px-4 pb-1 text-xs text-zinc-500">{typingLabel}</div>
      )}

      {uploadError && (
        <div className="px-4 pb-1 text-xs text-red-600">{uploadError}</div>
      )}

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-black/10 dark:border-white/10 p-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          aria-label="צירוף קובץ"
          className="shrink-0 text-lg opacity-60 hover:opacity-100 disabled:opacity-30"
        >
          📎
        </button>
        <input
          type="text"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            notifyTyping();
          }}
          placeholder={uploading ? "מעלה קובץ..." : "הקלד/י הודעה..."}
          disabled={uploading}
          className="flex-1 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || uploading || !content.trim()}
          className="rounded-full bg-foreground text-background px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          שליחה
        </button>
      </form>
    </div>
  );
}
