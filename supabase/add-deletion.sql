-- Run this once to allow deleting groups (owner only) and dismissing
-- "frequently bought" suggestion chips (any member). Safe to re-run.

drop policy if exists "Owners can delete their groups" on public.groups;
create policy "Owners can delete their groups"
  on public.groups for delete
  to authenticated
  using (exists (
    select 1 from public.group_members
    where group_id = groups.id and user_id = auth.uid() and role = 'owner'
  ));

grant delete on public.groups to authenticated;

drop policy if exists "Members can delete their group's item stats" on public.shopping_item_stats;
create policy "Members can delete their group's item stats"
  on public.shopping_item_stats for delete
  to authenticated
  using (public.is_group_member(group_id));

grant delete on public.shopping_item_stats to authenticated;
