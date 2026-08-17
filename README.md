# Realtime Chat & Shopping List

A realtime family app built with Next.js (App Router) and Supabase — email/password auth, Postgres-backed chat with Row Level Security and live delivery via Supabase Realtime, plus a shared shopping list with AI-powered item categorization.

## Features

**Chat**
- Email/password sign up & sign in, with route protection
- Live messaging — new messages appear instantly for everyone, no reload
- Inline message editing and deletion (your own messages only), synced live
- Emoji reactions (👍❤️😂😮😢), synced live
- "X is typing…" indicator (Realtime Broadcast, not persisted to the DB)
- Online presence — green dot + "online now" list, synced live via Realtime Presence
- Read receipts via presence — only counts as "read" while the tab is actually focused
- Client-side message search with highlighting
- Unread-messages badge when new messages arrive while scrolled up
- Mobile-friendly: tap-to-reveal for edit/delete/reactions (no reliance on hover)

**Shopping list**
- Shared, realtime-synced shopping list at `/shopping`
- Adding an item automatically classifies it into one of 18 categories (produce, dairy, meat, disposables, baby products, pet food, health/supplements, etc.) via the Claude API — the list groups by category
- Optional quantity and manual estimated price per item
- Check items off (shows who added / who checked it off), delete items
- Responsive on mobile — no fixed-width layout breakage

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [Supabase](https://supabase.com) — Auth, Postgres, Realtime
- [Anthropic Claude API](https://platform.claude.com) (`@anthropic-ai/sdk`) — shopping item categorization (Claude Haiku 4.5)
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

`ANTHROPIC_API_KEY` has no `NEXT_PUBLIC_` prefix — it's used only server-side (in `app/api/categorize/route.ts`) and must never be exposed to the browser.

### 4. Run the database schema

In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.

This creates:

- `public.profiles` — one row per user, holding a `username`, auto-populated on signup via a trigger
- `public.messages` — chat messages, with a foreign key to `profiles` (not `auth.users`) so Supabase can embed the sender's username in a single query, plus an `updated_at` column for the "edited" indicator
- `public.message_reactions` — emoji reactions per message/user
- `public.groups` — minimal group table (one seeded default group today; the FK is in place so a future per-family-group feature won't need a schema change to `shopping_items`)
- `public.shopping_items` — name, category, quantity, estimated price, checked state, who added/checked it
- Row Level Security policies on every table, plus table `GRANT`s for the `authenticated` role (RLS alone isn't enough — Postgres also needs base grants)
- Realtime enabled on `messages`, `message_reactions`, and `shopping_items`

`schema.sql` is the full, current schema for a fresh project. The other files in `supabase/` (`fix-grants.sql`, `fix-messages-fk.sql`, `add-edit-delete.sql`, `add-reactions.sql`, `add-shopping-list.sql`) are one-time, idempotent patches applied during development to an already-running database — not needed for a new setup.

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login` to sign up or sign in, then to `/chat`. Use the 🛒 icon in the chat header to get to `/shopping` (and 💬 to get back).

## How it works

- **Auth**: `@supabase/ssr` wires Supabase sessions into cookies for both server and client components (`lib/supabase/server.ts`, `lib/supabase/client.ts`).
- **Route protection**: `proxy.ts` refreshes the session on every request and redirects unauthenticated users away from `/chat` and `/shopping`, and authenticated users away from `/login`. It also forwards the already-verified user id (and email) to Server Components via an `x-user-id` request header, so `page.tsx` files don't need to re-verify the session with a second round trip to Supabase.
- **Chat UI**: `app/chat/page.tsx` is a server component that loads the current user and message history; `app/chat/chat-room.tsx` is a client component that renders the list, sends/edits/deletes messages, manages reactions/search/unread-badge, and subscribes to Realtime for live updates.
- **Realtime auth**: the Supabase Realtime socket needs the user's access token explicitly passed via `supabase.realtime.setAuth()` before subscribing — the browser client doesn't wire this up automatically, and without it, RLS silently rejects incoming realtime events.
- **Live message sync**: a single channel (`messages-changes`) carries several things at once — `postgres_changes` (INSERT/UPDATE/DELETE) for messages and reactions, `broadcast` for the typing indicator (ephemeral, never written to the DB), and `presence` for who's online and each user's last-read message id (used for read receipts, gated on `document.hasFocus()` so a backgrounded tab doesn't count as "read").
- **Shopping list UI**: `app/shopping/page.tsx` loads items and all profiles (for display names) in parallel; `app/shopping/shopping-list.tsx` handles add/check/delete and subscribes to Realtime the same way chat does.
- **AI categorization**: `app/api/categorize/route.ts` is a server-side Route Handler (auth-gated) that calls Claude Haiku 4.5 with `output_config.format` (structured JSON output) constrained to the category list in [`lib/shopping.ts`](lib/shopping.ts). The category names are also spelled out as plain text in the prompt — the JSON schema `enum` alone only constrains the output *format*, it doesn't tell the model what the options actually are, so both are needed for accurate classification.

## Project structure

```
app/
  login/page.tsx           Sign up / sign in
  chat/page.tsx              Server component: loads user + message history
  chat/chat-room.tsx          Client component: messages, reactions, search, realtime
  shopping/page.tsx            Server component: loads shopping items + profiles
  shopping/shopping-list.tsx    Client component: add/check/delete items, realtime
  api/categorize/route.ts        Route Handler: AI item categorization (Claude API)
lib/
  shopping.ts                     Category list + default group id (shared client/server)
  supabase/
    client.ts                      Browser Supabase client
    server.ts                       Server Supabase client (Server Components, Route Handlers)
    proxy.ts                         Session refresh + redirect logic, used by proxy.ts
proxy.ts                              Next.js Proxy (formerly "Middleware") entry point
supabase/
  schema.sql                          Full DB schema — run this in a fresh project
  add-shopping-list.sql                 Idempotent migration for an existing DB
```
