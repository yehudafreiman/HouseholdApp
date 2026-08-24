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

-- 3. Groups: a user can belong to several groups at once (e.g. different
-- families/households), each with its own chat and shopping list. Real
-- membership lives in group_members below.
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles (id),
  -- Persistent, owner-regeneratable invite code (not a one-time token —
  -- for a family-scale app a large-alphabet 8-char code is impractical to
  -- guess, and the owner can regenerate it any time to kill a leaked one).
  invite_code text not null,
  created_at timestamptz not null default now()
);

-- Seeded row kept only so a migrated database and a fresh install share the
-- same shape (existing users get enrolled here by add-groups.sql). A fresh
-- install's first real user goes through the app's create/join flow and
-- never touches this row.
insert into public.groups (id, name, invite_code)
values ('00000000-0000-0000-0000-000000000001', 'ברירת מחדל', 'A1B2C3D4')
on conflict (id) do nothing;

alter table public.groups enable row level security;

create unique index if not exists groups_invite_code_key on public.groups (invite_code);

-- 4. Group membership.
create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

-- 5. Membership-check helper. security definer lets group_members' own
-- select policy call this without RLS self-recursion (same trick
-- handle_new_user() uses above to insert into profiles from a trigger).
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

grant execute on function public.is_group_member(uuid) to authenticated;

-- 6. Create/join RPCs. A not-yet-member can't select a group by invite code
-- once groups' select policy is membership-only, so these run as security
-- definer to look up + insert atomically, without ever loosening that
-- policy to "everyone can see every group".
create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  insert into public.groups (name, created_by, invite_code)
  values (p_name, auth.uid(), upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)))
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'owner');

  return v_group_id;
end;
$$;

grant execute on function public.create_group(text) to authenticated;

create or replace function public.join_group_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from public.groups where invite_code = upper(p_code);
  if v_group_id is null then
    raise exception 'invalid_invite_code';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

grant execute on function public.join_group_by_code(text) to authenticated;

-- 7. groups / group_members RLS.
create policy "Members can view their groups"
  on public.groups for select
  to authenticated
  using (public.is_group_member(id));

create policy "Owners can update their groups"
  on public.groups for update
  to authenticated
  using (exists (
    select 1 from public.group_members
    where group_id = groups.id and user_id = auth.uid() and role = 'owner'
  ))
  with check (exists (
    select 1 from public.group_members
    where group_id = groups.id and user_id = auth.uid() and role = 'owner'
  ));

create policy "Owners can delete their groups"
  on public.groups for delete
  to authenticated
  using (exists (
    select 1 from public.group_members
    where group_id = groups.id and user_id = auth.uid() and role = 'owner'
  ));

grant select, update, delete on public.groups to authenticated;
-- No insert grant: groups are only ever created via create_group() above.

create policy "Members can view their groups' membership"
  on public.group_members for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "Users can leave a group"
  on public.group_members for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, delete on public.group_members to authenticated;
-- No insert grant: membership rows are only ever created via the RPCs
-- above, which run as security definer and bypass this grant entirely.

-- 8. Messages table.
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade
    default '00000000-0000-0000-0000-000000000001',
  -- References profiles (not auth.users) so PostgREST can embed
  -- `profiles(username)` in a `select` on this table.
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null default '',
  -- Attachments (all nullable — a message can be text-only, file-only, or
  -- both). Path convention: {group_id}/{user_id}/{uuid}-{filename}, so
  -- storage RLS can check membership straight from the object path.
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_content_or_attachment_check
    check (char_length(trim(content)) > 0 or attachment_path is not null)
);

create index if not exists messages_group_id_created_at_idx on public.messages (group_id, created_at);

alter table public.messages enable row level security;

create policy "Members can view their group's messages"
  on public.messages for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "Members can insert their own messages"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = user_id and public.is_group_member(group_id));

create policy "Members can update their own messages"
  on public.messages for update
  to authenticated
  using (auth.uid() = user_id and public.is_group_member(group_id))
  with check (auth.uid() = user_id and public.is_group_member(group_id));

create policy "Members can delete their own messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = user_id and public.is_group_member(group_id));

grant select, insert, update, delete on public.messages to authenticated;

-- 9. Turn on Realtime for the messages table.
alter publication supabase_realtime add table public.messages;

-- 10. Emoji reactions on messages. No own group_id column — it's a pure
-- child row of messages, always dereferenced via message_id, so RLS goes
-- through a join to the parent message instead of denormalizing group_id.
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

create policy "Members can view their group's reactions"
  on public.message_reactions for select
  to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_group_member(m.group_id)
  ));

create policy "Members can add their own reactions"
  on public.message_reactions for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_group_member(m.group_id)
    )
  );

create policy "Users can remove their own reactions"
  on public.message_reactions for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.message_reactions to authenticated;

-- 11. Turn on Realtime for reactions too.
alter publication supabase_realtime add table public.message_reactions;

-- 12. Shopping list items.
create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  -- Assigned by the app (AI-suggested or manual) from a fixed list of
  -- categories kept in app code, not enforced here — keeps it easy to add
  -- new categories without a migration.
  category text,
  quantity text,
  -- Rough estimate only — nothing here claims to be a real, current price.
  estimated_price numeric(10, 2),
  is_checked boolean not null default false,
  -- A wishlist item is a normal row with is_wishlist = true, kept out of
  -- the active shopping list until moved over ("עברתי לקנייה").
  is_wishlist boolean not null default false,
  added_by uuid not null references public.profiles (id) on delete cascade,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shopping_items enable row level security;

create policy "Members can view their group's shopping items"
  on public.shopping_items for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "Members can add shopping items to their group"
  on public.shopping_items for insert
  to authenticated
  with check (auth.uid() = added_by and public.is_group_member(group_id));

-- Unlike messages, any member can update/delete any item (check things off,
-- fix quantities, remove duplicates) — it's a shared list, not personal posts.
create policy "Members can update their group's shopping items"
  on public.shopping_items for update
  to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy "Members can delete their group's shopping items"
  on public.shopping_items for delete
  to authenticated
  using (public.is_group_member(group_id));

grant select, insert, update, delete on public.shopping_items to authenticated;

-- 13. Turn on Realtime for the shopping list too.
alter publication supabase_realtime add table public.shopping_items;

-- 14. Chat attachments. Private bucket — accessible only via signed URLs,
-- gated by the same group-membership rule as everything else. Objects are
-- keyed as {group_id}/{user_id}/{uuid}-{filename}, so storage.foldername(name)
-- = ARRAY[group_id, user_id] without a denormalized column on storage.objects.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 26214400)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

create policy "Group members can view attachments"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

create policy "Group members can upload their own attachments"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Uploaders can delete their own attachments"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- 15. Purchase-frequency stats, for "frequently bought" quick-add
-- suggestions. Independent of shopping_items rows so the history survives
-- an item being checked off and later cleared.
create table if not exists public.shopping_item_stats (
  group_id      uuid not null references public.groups (id) on delete cascade,
  name          text not null,
  category      text,
  times_bought  integer not null default 0,
  last_bought_at timestamptz,
  primary key (group_id, name)
);

alter table public.shopping_item_stats enable row level security;

create policy "Members can view their group's item stats"
  on public.shopping_item_stats for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "Members can upsert their group's item stats"
  on public.shopping_item_stats for insert
  to authenticated
  with check (public.is_group_member(group_id));

create policy "Members can update their group's item stats"
  on public.shopping_item_stats for update
  to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy "Members can delete their group's item stats"
  on public.shopping_item_stats for delete
  to authenticated
  using (public.is_group_member(group_id));

grant select, insert, update, delete on public.shopping_item_stats to authenticated;

create or replace function public.bump_item_stat(p_group_id uuid, p_name text, p_category text)
returns void
language sql
as $$
  insert into public.shopping_item_stats (group_id, name, category, times_bought, last_bought_at)
  values (p_group_id, p_name, p_category, 1, now())
  on conflict (group_id, name)
  do update set
    times_bought = public.shopping_item_stats.times_bought + 1,
    category = excluded.category,
    last_bought_at = excluded.last_bought_at;
$$;

grant execute on function public.bump_item_stat(uuid, text, text) to authenticated;
