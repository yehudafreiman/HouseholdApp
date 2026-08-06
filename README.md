# Realtime Chat

A realtime chat app built with Next.js (App Router) and Supabase — email/password auth, Postgres-backed messages with Row Level Security, and live message delivery via Supabase Realtime.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [Supabase](https://supabase.com) — Auth, Postgres, Realtime
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

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run the database schema

In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.

This creates:

- `public.profiles` — one row per user, holding a `username`, auto-populated on signup via a trigger
- `public.messages` — chat messages, with a foreign key to `profiles` (not `auth.users`) so Supabase can embed the sender's username in a single query
- Row Level Security policies: any authenticated user can read all messages/profiles, but can only insert messages or update a profile as themselves
- Table grants for the `authenticated` role (RLS alone isn't enough — Postgres also needs base `GRANT` privileges)
- Realtime enabled on the `messages` table

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login` to sign up or sign in, then to `/chat`.

## How it works

- **Auth**: `@supabase/ssr` wires Supabase sessions into cookies for both server and client components (`lib/supabase/server.ts`, `lib/supabase/client.ts`).
- **Route protection**: `proxy.ts` refreshes the session on every request and redirects unauthenticated users away from `/chat`, and authenticated users away from `/login`.
- **Chat UI**: `app/chat/page.tsx` is a server component that loads the current user and message history; `app/chat/chat-room.tsx` is a client component that renders the list, sends new messages, and subscribes to `postgres_changes` on the `messages` table for live updates.
- **Realtime auth**: the Supabase Realtime socket needs the user's access token explicitly passed via `supabase.realtime.setAuth()` before subscribing — the browser client doesn't wire this up automatically, and without it, RLS silently rejects incoming realtime events.

## Project structure

```
app/
  login/page.tsx       Sign up / sign in
  chat/page.tsx         Server component: loads user + message history
  chat/chat-room.tsx     Client component: message list, input, realtime subscription
lib/supabase/
  client.ts              Browser Supabase client
  server.ts               Server Supabase client (Server Components, Route Handlers)
  proxy.ts                 Session refresh + redirect logic, used by proxy.ts
proxy.ts                   Next.js Proxy (formerly "Middleware") entry point
supabase/
  schema.sql                Full DB schema — run this in a fresh project
```
