-- Run this once to add "frequently bought" quick-add suggestions.
-- Safe to re-run: every step is idempotent.
--
-- Tracks purchase frequency per (group, item name), independent of the
-- shopping_items rows themselves — so the history survives an item being
-- checked off and later cleared (see "נקה מסומנים"), which hard-deletes
-- the shopping_items row.

create table if not exists public.shopping_item_stats (
  group_id      uuid not null references public.groups (id) on delete cascade,
  name          text not null,
  category      text,
  times_bought  integer not null default 0,
  last_bought_at timestamptz,
  primary key (group_id, name)
);

alter table public.shopping_item_stats enable row level security;

drop policy if exists "Members can view their group's item stats" on public.shopping_item_stats;
create policy "Members can view their group's item stats"
  on public.shopping_item_stats for select
  to authenticated
  using (public.is_group_member(group_id));

drop policy if exists "Members can upsert their group's item stats" on public.shopping_item_stats;
create policy "Members can upsert their group's item stats"
  on public.shopping_item_stats for insert
  to authenticated
  with check (public.is_group_member(group_id));

drop policy if exists "Members can update their group's item stats" on public.shopping_item_stats;
create policy "Members can update their group's item stats"
  on public.shopping_item_stats for update
  to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

grant select, insert, update on public.shopping_item_stats to authenticated;

-- Atomic upsert-increment, called when an item is checked off (bought).
-- No security definer needed — the insert/update RLS policies above
-- already permit this for group members, so it runs as the calling user.
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
