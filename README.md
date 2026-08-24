# Household App — Groups, Chat & Shopping

A realtime household-coordination app built with Next.js (App Router) and Supabase — email/password auth, multiple isolated household groups, Postgres-backed chat with Row Level Security and live delivery via Supabase Realtime, and a shared shopping list (plus a non-urgent wishlist) with AI-powered item categorization.

## Features

**Groups**
- A user can belong to multiple groups at once (e.g. more than one household) — each group has its own fully isolated chat and shopping list, enforced at the RLS layer, not just the UI
- Create a group or join one via a shareable invite code (WhatsApp-group style) — no contact picker
- A group switcher appears once you're in more than one group; with exactly one group you land straight in it, with a `+` link always available to reach the create/join screen
- Owners can permanently delete a group — chat, shopping list, and membership all cascade via existing foreign keys, gated behind a confirm dialog and an owner-only RLS policy
- Old `/chat` and `/shopping` URLs (from before groups existed) redirect into `/groups`, so existing bookmarks/home-screen shortcuts keep working
- A tab bar (💬 chat / 🛒 shopping / ⭐ wishlist) always shows all three sections with the active one highlighted, so it's clear which page you're on — invite/feedback/sign-out sit apart from it as smaller, muted "actions from here" links, not navigation

**Chat**
- Live messaging — new messages appear instantly for everyone, no reload
- File attachments — any file type, up to 25MB, one per message. Private Supabase Storage bucket, RLS-scoped to group membership; images preview inline, other files show as a download chip
- Inline message editing and deletion (your own messages only), synced live
- Emoji reactions (👍❤️😂😮😢), synced live
- "X is typing…" indicator (Realtime Broadcast, not persisted to the DB)
- Online presence — green dot + "online now" list, synced live via Realtime Presence
- Read receipts via presence — only counts as "read" while the tab is actually focused
- Client-side message search with highlighting
- Unread-messages badge when new messages arrive while scrolled up
- Mobile-friendly: tap-to-reveal for edit/delete/reactions (no reliance on hover)

**Shopping list**
- Shared, realtime-synced list per group
- Adding an item classifies it into one of 22 categories via the Claude API — the list groups by category. Adding doesn't wait on the AI call: the item appears immediately and re-categorizes in the background once the classification comes back
- Name, quantity, and price are all on one row with the add button — no extra line for the optional fields
- "קונים לעיתים קרובות" — items bought 2+ times show as tap-to-add suggestion chips, using the category already known from history (skips the AI call entirely); each chip can be dismissed on its own with a small "✕" if it's not actually a staple
- Check items off (tapping anywhere on the row, not just a small checkbox); "נקה מסומנים" bulk-clears everything checked in one action
- Delete is a plain "✕" per item, matching the original design language rather than a heavier icon button

**Wishlist**
- A separate, non-urgent list at `/groups/[groupId]/wishlist` for things spotted in-store that aren't worth interrupting the current trip for
- "עברתי לקנייה" moves an item into the real shopping list in one action — it keeps whatever category it already resolved to
- Same single-row add form as the shopping list

**Feedback**
- 📮 in the header opens a simple bug/suggestion form at `/groups/[groupId]/feedback`
- No backend or storage — submitting just opens a `mailto:` link to the developer with the sender and group name filled in automatically

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [Supabase](https://supabase.com) — Auth, Postgres, Realtime, Storage
- [Anthropic Claude API](https://platform.claude.com) (`@anthropic-ai/sdk`) — shopping item categorization (`claude-sonnet-5`)
- [Tailwind CSS](https://tailwindcss.com) v4
- TypeScript

> **Note:** this project runs on a pre-release Next.js version with some breaking changes from the docs you may know — most notably, `middleware.ts` is renamed `proxy.ts`. See [`AGENTS.md`](AGENTS.md).

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Supabase

Create a project at [supabase.com](https://supabase.com), then in **Project Settings → API** grab your **Project URL** and **anon/publishable key**.

### 3. Set up the Claude API (for shopping list categorization)

Create an API key at [platform.claude.com](https://platform.claude.com) (**API Keys** in the console — this is a separate product from a Claude.ai/Pro subscription and is billed separately, pay-as-you-go). Categorizing an item is a tiny request, so cost per item is a small fraction of a cent even with heavy use.

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

`ANTHROPIC_API_KEY` has no `NEXT_PUBLIC_` prefix — it's used only server-side (in [`lib/categorize.ts`](lib/categorize.ts), called from [`app/api/categorize/route.ts`](app/api/categorize/route.ts)) and must never be exposed to the browser.

### 4. Run the database schema

In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This is the full, current schema for a fresh project — it includes everything below in one pass (groups, chat, shopping, wishlist, attachments storage).

This creates:

- `public.profiles` — one row per user, holding a `username`, auto-populated on signup via a trigger
- `public.groups` / `public.group_members` — households a user belongs to, with an owner role and a regeneratable invite code; `is_group_member()` is a `security definer` helper used throughout the RLS policies below to avoid self-recursion
- `public.messages` / `public.message_reactions` — chat messages (with `attachment_path`/`attachment_name`/`attachment_type`/`attachment_size` for file attachments) and emoji reactions, scoped by `group_id`
- `public.shopping_items` — name, category, quantity, estimated price, checked state, `is_wishlist` flag, who added/checked it — scoped by `group_id`
- `public.shopping_item_stats` — purchase-frequency tracking per (group, item name), independent of `shopping_items` rows, feeding the "frequently bought" suggestions
- The `chat-attachments` Storage bucket (private) plus `storage.objects` RLS policies scoped to group membership via the object path
- Row Level Security policies on every table, plus table `GRANT`s for the `authenticated` role (RLS alone isn't enough — Postgres also needs base grants)
- Realtime enabled on `messages`, `message_reactions`, and `shopping_items`

For an **already-running** database, apply the incremental migrations instead, in order — each is idempotent (safe to re-run): `add-groups.sql` → `add-attachments.sql` → `add-item-stats.sql` → `add-wishlist.sql` → `add-deletion.sql` (owner-only group deletion + dismissible frequency suggestions). (`fix-grants.sql`, `fix-messages-fk.sql`, `add-edit-delete.sql`, `add-reactions.sql`, `add-shopping-list.sql` are earlier historical patches, already folded into `schema.sql` — not needed for a new setup or if you're already past them.)

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login` to sign up or sign in, then to `/groups` — create a group or join one with an invite code. Inside a group, use the tab bar to switch between 💬 chat, 🛒 shopping, and ⭐ wishlist; 🔗 invite and 📮 feedback sit separately as smaller utility links.

### 6. Regression-test the categorizer (optional)

```bash
npm run test:categorize
```

Runs a curated set of representative/edge-case items against `lib/categorize.ts` directly (no server needed), calling each one twice to catch non-determinism, not just wrong answers — see [`scripts/test-categorization.ts`](scripts/test-categorization.ts). Worth re-running whenever the categorize prompt or model changes.

## How it works

- **Auth**: `@supabase/ssr` wires Supabase sessions into cookies for both server and client components ([`lib/supabase/server.ts`](lib/supabase/server.ts), [`lib/supabase/client.ts`](lib/supabase/client.ts)).
- **Route protection**: [`proxy.ts`](proxy.ts) (via [`lib/supabase/proxy.ts`](lib/supabase/proxy.ts)) refreshes the session on every request and redirects unauthenticated users away from `/groups` and `/join`, and authenticated users away from `/login`. It also forwards the already-verified user id (and email) to Server Components via an `x-user-id` request header, so `page.tsx` files don't need to re-verify the session with a second round trip to Supabase.
- **Groups**: [`app/groups/[groupId]/layout.tsx`](app/groups/[groupId]/layout.tsx) guards every route under a group, redirecting to `/groups` if the user isn't a member. Creating/joining a group goes through `security definer` RPCs (`create_group`, `join_group_by_code`) so a not-yet-member can look up a group by invite code without the `groups` table's select policy ever being loosened to "everyone can see every group."
- **Chat UI**: `app/groups/[groupId]/chat/page.tsx` is a server component that loads the current user and message history; `chat-room.tsx` is a client component that renders the list, sends/edits/deletes messages, handles attachments, manages reactions/search/unread-badge, and subscribes to Realtime for live updates.
- **Shopping/wishlist UI**: `app/groups/[groupId]/shopping/{page,shopping-list}.tsx` and `app/groups/[groupId]/wishlist/{page,wishlist}.tsx` follow the same server-loads/client-subscribes split. A wishlist item is a normal `shopping_items` row with `is_wishlist = true` — not a separate table — so "עברתי לקנייה" is a single `UPDATE` instead of a delete+insert.
- **Realtime auth**: the Supabase Realtime socket needs the user's access token explicitly passed via `supabase.realtime.setAuth()` before subscribing — the browser client doesn't wire this up automatically, and without it, RLS silently rejects incoming realtime events.
- **Realtime filter caution**: Postgres `DELETE` events without `REPLICA IDENTITY FULL` only carry primary-key columns in `payload.old` — a Realtime `filter` referencing any other column (like `group_id`) on a `DELETE` subscription silently matches nothing, dropping every delete event with no error. Every list in this app (messages, shopping items) subscribes to `DELETE` **unfiltered** and matches by id client-side instead. The same caution applies to `is_wishlist`: rather than adding a second equality clause to a Realtime filter string, the shopping list and wishlist filter `is_wishlist` client-side in their `INSERT`/`UPDATE` handlers.
- **Presence/broadcast have no RLS**: typing indicators and online presence are scoped only by using a channel name unique per group (e.g. `messages-changes-${groupId}`) — there's no database-level protection for these the way `postgres_changes` events get from RLS.
- **AI categorization**: [`lib/categorize.ts`](lib/categorize.ts) calls Claude (`claude-sonnet-5`) with `output_config.format` (structured JSON output) constrained to the category list in [`lib/shopping.ts`](lib/shopping.ts) — the category names are also spelled out as plain text in the prompt, since the JSON schema `enum` alone only constrains output *format*, not what the model knows the options mean. The route handler ([`app/api/categorize/route.ts`](app/api/categorize/route.ts)) and the test script both call this one implementation. Sonnet 5 sometimes emits a leading `thinking` content block before its answer even for a short classification call — the code finds the `text` block explicitly rather than assuming `response.content[0]` is the answer, which was a real (silent, non-obvious) bug here before.
- **Attachments**: objects in the `chat-attachments` bucket are keyed `{group_id}/{user_id}/{uuid}-{filename}`, so `storage.foldername(name)` gives Postgres RLS policies the group and uploader without a denormalized column. The bucket is private — display/download goes through short-lived signed URLs.
- **Group deletion**: `groups` has no delete policy by default (per the original multi-group design) — `add-deletion.sql`/`schema.sql` add one scoped to `role = 'owner'` in `group_members`. Deleting a group cascades to its messages, shopping items, and memberships through the existing foreign keys; the UI gates it behind a native `confirm()` dialog.
- **Feedback**: [`app/groups/[groupId]/feedback/feedback-form.tsx`](app/groups/[groupId]/feedback/feedback-form.tsx) deliberately has no backend — it composes a `mailto:` link client-side, so there's nothing to store or secure beyond the existing page-level membership guard.

## Project structure

```
app/
  login/page.tsx                      Sign up / sign in
  groups/page.tsx                       Group picker / create / join
  groups/create-group-form.tsx
  groups/join-group-form.tsx
  groups/[groupId]/layout.tsx           Membership guard for everything below
  groups/[groupId]/chat/{page,chat-room}.tsx        Chat, incl. attachments
  groups/[groupId]/shopping/{page,shopping-list}.tsx Shopping list
  groups/[groupId]/wishlist/{page,wishlist}.tsx      Non-urgent wishlist
  groups/[groupId]/invite/{page,invite-code-display}.tsx  Invite link, owner-only regenerate + group deletion
  groups/[groupId]/feedback/{page,feedback-form}.tsx  Bug/suggestion form -> mailto:
  join/[code]/{page,join-group-client}.tsx  Auto-join-on-visit flow
  chat/page.tsx, shopping/page.tsx      Legacy redirect shims -> /groups
  api/categorize/route.ts               Route Handler: AI item categorization
components/
  group-header.tsx                      Tab bar (chat/shopping/wishlist) + utility links
  group-switcher.tsx                    Group dropdown (only shown with 2+ groups)
lib/
  categorize.ts                         Categorize prompt + Claude call (shared with the test script)
  shopping.ts                           Category list (shared client/server)
  supabase/
    client.ts                           Browser Supabase client
    server.ts                           Server Supabase client (Server Components, Route Handlers)
    proxy.ts                            Session refresh + redirect logic, used by proxy.ts
proxy.ts                                Next.js Proxy (formerly "Middleware") entry point
scripts/
  test-categorization.ts                Regression test for the categorizer (npm run test:categorize)
supabase/
  schema.sql                            Full DB schema — run this in a fresh project
  add-groups.sql, add-attachments.sql,
  add-item-stats.sql, add-wishlist.sql,
  add-deletion.sql                      Idempotent migrations for an existing DB, in order
```
