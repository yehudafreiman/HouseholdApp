-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).

-- 1. Profiles table: stores a public username per auth user.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

grant select, update on public.profiles to authenticated;

-- 2. Auto-create a profile row whenever a new user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Messages table.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  -- References profiles (not auth.users) so PostgREST can embed
  -- `profiles(username)` in a `select` on this table.
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "Messages are viewable by authenticated users"
  on public.messages for select
  to authenticated
  using (true);

create policy "Users can insert their own messages"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own messages"
  on public.messages for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.messages to authenticated;

-- 4. Turn on Realtime for the messages table.
alter publication supabase_realtime add table public.messages;

-- 5. Emoji reactions on messages.
create table if not exists public.message_reactions (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  -- References profiles (not auth.users) for the same PostgREST-embedding
  -- reason as messages.user_id above.
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;

create policy "Reactions are viewable by authenticated users"
  on public.message_reactions for select
  to authenticated
  using (true);

create policy "Users can add their own reactions"
  on public.message_reactions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can remove their own reactions"
  on public.message_reactions for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.message_reactions to authenticated;

-- 6. Turn on Realtime for reactions too.
alter publication supabase_realtime add table public.message_reactions;

-- 7. Groups: minimal for now (just enough for shopping_items.group_id to
-- have a real FK target). A single seeded "default" group stands in for
-- real group membership/creation, which lands in a later feature. When
-- that arrives, more rows get added here and a group_members table joins
-- users to them — shopping_items itself won't need to change.
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.groups (id, name)
values ('00000000-0000-0000-0000-000000000001', 'ברירת מחדל')
on conflict (id) do nothing;

alter table public.groups enable row level security;

create policy "Groups are viewable by authenticated users"
  on public.groups for select
  to authenticated
  using (true);

grant select on public.groups to authenticated;

-- 8. Shopping list items.
create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade
    default '00000000-0000-0000-0000-000000000001',
  name text not null check (char_length(trim(name)) > 0),
  -- Assigned by the app (AI-suggested or manual) from a fixed list of
  -- categories kept in app code, not enforced here — keeps it easy to add
  -- new categories without a migration.
  category text,
  quantity text,
  -- Rough estimate only — nothing here claims to be a real, current price.
  estimated_price numeric(10, 2),
  is_checked boolean not null default false,
  added_by uuid not null references public.profiles (id) on delete cascade,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shopping_items enable row level security;

create policy "Shopping items are viewable by authenticated users"
  on public.shopping_items for select
  to authenticated
  using (true);

create policy "Authenticated users can add shopping items"
  on public.shopping_items for insert
  to authenticated
  with check (auth.uid() = added_by);

-- Unlike messages, any member can update/delete any item (check things off,
-- fix quantities, remove duplicates) — it's a shared list, not personal posts.
create policy "Authenticated users can update shopping items"
  on public.shopping_items for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated users can delete shopping items"
  on public.shopping_items for delete
  to authenticated
  using (true);

grant select, insert, update, delete on public.shopping_items to authenticated;

-- 9. Turn on Realtime for the shopping list too.
alter publication supabase_realtime add table public.shopping_items;
