-- Run this once to add multi-group support to an existing database.
-- Safe to re-run: every step is idempotent.
--
-- Apply this BEFORE deploying the new app code. The old app code keeps
-- working unchanged against this schema (it never touches group_id on
-- chat, and always passes the same default group_id on shopping items) —
-- this migration just enrolls every existing user into the one existing
-- group so nothing breaks while the old and new code briefly coexist.

-- 1. Group membership.
create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_members enable row level security;

-- 2. Groups gain an owner + a persistent, regeneratable invite code.
alter table public.groups add column if not exists created_by uuid references public.profiles (id);
alter table public.groups add column if not exists invite_code text;

update public.groups
set invite_code = upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
where invite_code is null;

alter table public.groups alter column invite_code set not null;
create unique index if not exists groups_invite_code_key on public.groups (invite_code);

-- 3. Membership-check helper. security definer lets group_members' own
-- select policy call this without RLS self-recursion (same trick
-- handle_new_user() already uses to insert into profiles from a trigger).
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

-- 4. Create/join RPCs. A not-yet-member can't select a group by invite code
-- once groups' select policy is membership-only (below), so these run as
-- security definer to look up + insert atomically, without ever loosening
-- that policy to "everyone can see every group".
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

-- 5. Backfill: enroll everyone who already has an account into the existing
-- default group (as owner — today's default group has no real hierarchy),
-- so nothing breaks for current users.
insert into public.group_members (group_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', id, 'owner'
from public.profiles
on conflict (group_id, user_id) do nothing;

-- 6. group_members RLS.
drop policy if exists "Members can view their groups' membership" on public.group_members;
create policy "Members can view their groups' membership"
  on public.group_members for select
  to authenticated
  using (public.is_group_member(group_id));

drop policy if exists "Users can leave a group" on public.group_members;
create policy "Users can leave a group"
  on public.group_members for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, delete on public.group_members to authenticated;
-- No insert grant: membership rows are only ever created via the RPCs
-- above, which run as security definer and bypass this grant entirely.

-- 7. groups RLS: replace "viewable by everyone" with membership-scoped.
drop policy if exists "Groups are viewable by authenticated users" on public.groups;
create policy "Members can view their groups"
  on public.groups for select
  to authenticated
  using (public.is_group_member(id));

drop policy if exists "Owners can update their groups" on public.groups;
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

grant select, update on public.groups to authenticated;
-- No insert grant: groups are only ever created via create_group() above.

-- 8. messages: add group_id (nullable -> backfill -> not null), then
-- rewrite RLS from "everyone sees everything" to membership-scoped.
alter table public.messages add column if not exists group_id uuid references public.groups (id) on delete cascade;

update public.messages set group_id = '00000000-0000-0000-0000-000000000001' where group_id is null;

alter table public.messages alter column group_id set default '00000000-0000-0000-0000-000000000001';
alter table public.messages alter column group_id set not null;

create index if not exists messages_group_id_created_at_idx on public.messages (group_id, created_at);

drop policy if exists "Messages are viewable by authenticated users" on public.messages;
create policy "Members can view their group's messages"
  on public.messages for select
  to authenticated
  using (public.is_group_member(group_id));

drop policy if exists "Users can insert their own messages" on public.messages;
create policy "Members can insert their own messages"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = user_id and public.is_group_member(group_id));

drop policy if exists "Users can update their own messages" on public.messages;
create policy "Members can update their own messages"
  on public.messages for update
  to authenticated
  using (auth.uid() = user_id and public.is_group_member(group_id))
  with check (auth.uid() = user_id and public.is_group_member(group_id));

drop policy if exists "Users can delete their own messages" on public.messages;
create policy "Members can delete their own messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = user_id and public.is_group_member(group_id));

-- 9. message_reactions RLS: no own group_id column (it's a pure child row
-- of messages), so scoping goes through a join to the parent message.
drop policy if exists "Reactions are viewable by authenticated users" on public.message_reactions;
create policy "Members can view their group's reactions"
  on public.message_reactions for select
  to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_group_member(m.group_id)
  ));

drop policy if exists "Users can add their own reactions" on public.message_reactions;
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
-- delete policy unchanged (already self-scoped: auth.uid() = user_id)

-- 10. shopping_items RLS: replace "everyone sees everything" with
-- membership-scoped. Drop the hardcoded default now that the app always
-- supplies group_id explicitly (there's no single "the" group anymore).
alter table public.shopping_items alter column group_id drop default;

drop policy if exists "Shopping items are viewable by authenticated users" on public.shopping_items;
create policy "Members can view their group's shopping items"
  on public.shopping_items for select
  to authenticated
  using (public.is_group_member(group_id));

drop policy if exists "Authenticated users can add shopping items" on public.shopping_items;
create policy "Members can add shopping items to their group"
  on public.shopping_items for insert
  to authenticated
  with check (auth.uid() = added_by and public.is_group_member(group_id));

drop policy if exists "Authenticated users can update shopping items" on public.shopping_items;
create policy "Members can update their group's shopping items"
  on public.shopping_items for update
  to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists "Authenticated users can delete shopping items" on public.shopping_items;
create policy "Members can delete their group's shopping items"
  on public.shopping_items for delete
  to authenticated
  using (public.is_group_member(group_id));
