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
import {
  SearchIcon,
  XIcon,
  PaperclipIcon,
  ImageIcon,
  VideoIcon,
  MusicIcon,
  FileIcon,
  MoreHorizontalIcon,
  ArrowDownIcon,
} from "@/components/icons";

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

type Message = MessageRow & { username: string };

const ATTACHMENTS_BUCKET = "chat-attachments";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

const MESSAGES_KEY = (groupId: string) => ["chat-messages", groupId] as const;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) return <ImageIcon className={className} />;
  if (mimeType.startsWith("video/")) return <VideoIcon className={className} />;
  if (mimeType.startsWith("audio/")) return <MusicIcon className={className} />;
  return <FileIcon className={className} />;
}

function sanitizeFilename(name: string) {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
}

async function fetchMessages(groupId: string): Promise<Message[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("messages")
    .select(
      "id, content, created_at, updated_at, user_id, attachment_path, attachment_name, attachment_type, attachment_size, profiles(username)"
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
  // Which message's action row (edit/delete) is expanded — hover reveals it
  // on desktop, but touch devices have no hover, so tapping the "⋯" button
  // toggles this instead.
  const [activeMessageId, setActiveMessageId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

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
        return [...list, { ...row, username }];
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
    };

    const handleUpdate = (payload: RealtimePostgresUpdatePayload<MessageRow>) => {
      const row = payload.new;
      const username = resolveUsername(row.user_id);

      queryClient.setQueryData<Message[]>(MESSAGES_KEY(groupId), (prev) =>
        (prev ?? []).map((m) => (m.id === row.id ? { ...row, username } : m))
      );
    };

    const handleDelete = (payload: RealtimePostgresDeletePayload<MessageRow>) => {
      const deletedId = payload.old.id;
      if (deletedId === undefined) return;
      queryClient.setQueryData<Message[]>(MESSAGES_KEY(groupId), (prev) =>
        (prev ?? []).filter((m) => m.id !== deletedId)
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

      // Channel name is per-group so switching groups tears down and
      // rebuilds a fresh subscription scoped to the new group.
      let ch: RealtimeChannel = supabase.channel(`messages-changes-${groupId}`);
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
      ch.subscribe();

      channel = ch;
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [groupId, currentUserId, queryClient]);

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
            className="text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200 active:scale-90"
            aria-label="חיפוש בהודעות"
          >
            <SearchIcon className="h-[18px] w-[18px]" />
          </button>
        }
        subtitle={
          <span className="text-xs text-zinc-500">
            מחובר/ת בתור <span className="font-medium text-foreground">{currentUsername}</span>
          </span>
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
            className="flex-1 rounded-full bg-white dark:bg-zinc-900 shadow-inset px-4 py-1.5 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
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
            className="text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200 active:scale-90"
          >
            <XIcon className="h-4 w-4" />
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
          <div className="flex flex-col gap-3 animate-fade-in">
          {filteredMessages.map((m) => {
            const isMine = m.user_id === currentUserId;
            const isEditing = editingId === m.id;
            const isActive = activeMessageId === m.id;
            const wasEdited = m.updated_at !== m.created_at;

            return (
              <div
                key={m.id}
                className={`group flex flex-col max-w-[75%] ${isMine ? "self-end items-end" : "self-start items-start"}`}
              >
                {!isMine && (
                  <span className="text-xs text-zinc-500 mb-1">{m.username}</span>
                )}

                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      autoFocus
                      className="rounded-full bg-white dark:bg-zinc-900 shadow-inset px-4 py-2 text-base outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20"
                    />
                    <button
                      onClick={() => saveEdit(m.id)}
                      className="text-xs text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200 active:scale-90"
                    >
                      שמירה
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-xs text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200 active:scale-90"
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
                          className="transition hover:text-zinc-800 dark:hover:text-zinc-200 active:scale-90"
                        >
                          עריכה
                        </button>
                        <button
                          onClick={() => handleDeleteMessage(m.id)}
                          className="transition hover:text-red-600 active:scale-90"
                        >
                          מחיקה
                        </button>
                      </span>
                    )}
                    <button
                      onClick={() => setActiveMessageId(isActive ? null : m.id)}
                      className="text-zinc-400 opacity-60 transition hover:opacity-100 active:scale-90 px-1"
                      aria-label="פעולות נוספות"
                    >
                      <MoreHorizontalIcon className="h-4 w-4" />
                    </button>
                    <div
                      className={`rounded-2xl px-4 py-3 text-base shadow-raised ${
                        isMine
                          ? "bg-accent text-accent-foreground"
                          : "bg-white dark:bg-zinc-900"
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
                              <FileTypeIcon
                                mimeType={m.attachment_type ?? ""}
                                className="h-5 w-5 shrink-0"
                              />
                              <span className="flex flex-col">
                                <span className="text-xs font-medium truncate max-w-[12rem]">
                                  {m.attachment_name}
                                </span>
                                {m.attachment_size !== null && (
                                  <span
                                    className={`text-xs ${isMine ? "opacity-70" : "text-zinc-400"}`}
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
                          className={`text-xs mr-2 ${isMine ? "opacity-70" : "text-zinc-400"}`}
                        >
                          נערך
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {unreadCount > 0 && (
        <div className="flex justify-center pb-1">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1 rounded-full bg-accent text-accent-foreground text-xs px-4 py-1.5 shadow-raised transition hover:opacity-90 active:scale-95"
          >
            <ArrowDownIcon className="h-3.5 w-3.5" /> {unreadCount} הודעות חדשות
          </button>
        </div>
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
          className="shrink-0 opacity-60 transition hover:opacity-100 active:scale-90 disabled:opacity-30 disabled:active:scale-100"
        >
          <PaperclipIcon className="h-5 w-5" />
        </button>
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={uploading ? "מעלה קובץ..." : "הקלד/י הודעה..."}
          disabled={uploading}
          className="flex-1 rounded-full bg-white dark:bg-zinc-900 shadow-inset px-4 py-2 text-base outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || uploading || !content.trim()}
          className="rounded-full bg-accent text-accent-foreground px-5 py-2 text-base font-medium shadow-raised transition hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
        >
          שליחה
        </button>
      </form>
    </div>
  );
}
