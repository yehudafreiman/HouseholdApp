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
  created_at timestamptz not null default now()
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

grant select, insert on public.messages to authenticated;

-- 4. Turn on Realtime for the messages table.
alter publication supabase_realtime add table public.messages;
