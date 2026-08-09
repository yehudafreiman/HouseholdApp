-- Run this once to add edit/delete support to an existing database.
alter table public.messages
  add column if not exists updated_at timestamptz not null default now();

create policy "Users can update their own messages"
  on public.messages for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = user_id);

grant update, delete on public.messages to authenticated;
