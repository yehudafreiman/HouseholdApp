-- Run this once to add the shopping list to an existing database.
-- Safe to re-run: every step is idempotent.
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.groups (id, name)
values ('00000000-0000-0000-0000-000000000001', 'ברירת מחדל')
on conflict (id) do nothing;

alter table public.groups enable row level security;

drop policy if exists "Groups are viewable by authenticated users" on public.groups;
create policy "Groups are viewable by authenticated users"
  on public.groups for select
  to authenticated
  using (true);

grant select on public.groups to authenticated;

create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade
    default '00000000-0000-0000-0000-000000000001',
  name text not null check (char_length(trim(name)) > 0),
  category text,
  quantity text,
  estimated_price numeric(10, 2),
  is_checked boolean not null default false,
  added_by uuid not null references public.profiles (id) on delete cascade,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shopping_items enable row level security;

drop policy if exists "Shopping items are viewable by authenticated users" on public.shopping_items;
create policy "Shopping items are viewable by authenticated users"
  on public.shopping_items for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can add shopping items" on public.shopping_items;
create policy "Authenticated users can add shopping items"
  on public.shopping_items for insert
  to authenticated
  with check (auth.uid() = added_by);

drop policy if exists "Authenticated users can update shopping items" on public.shopping_items;
create policy "Authenticated users can update shopping items"
  on public.shopping_items for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete shopping items" on public.shopping_items;
create policy "Authenticated users can delete shopping items"
  on public.shopping_items for delete
  to authenticated
  using (true);

grant select, insert, update, delete on public.shopping_items to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_items'
  ) then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end $$;
