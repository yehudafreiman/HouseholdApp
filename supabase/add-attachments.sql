-- Run this once to add chat file attachments to an existing database.
-- Safe to re-run: every step is idempotent.

-- 1. Storage bucket. Private (public = false) — attachments are only
-- accessible via signed URLs, gated by the same group-membership rule as
-- everything else in this app. 25MB matches the app's client-side check.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 26214400)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- 2. Storage RLS. Objects are keyed as {group_id}/{user_id}/{uuid}-{name},
-- so storage.foldername(name) = ARRAY[group_id, user_id] without needing a
-- denormalized column on storage.objects. Reuses is_group_member() from
-- add-groups.sql.
drop policy if exists "Group members can view attachments" on storage.objects;
create policy "Group members can view attachments"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "Group members can upload their own attachments" on storage.objects;
create policy "Group members can upload their own attachments"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Uploaders can delete their own attachments" on storage.objects;
create policy "Uploaders can delete their own attachments"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- 3. messages: add attachment columns, and relax the content check so a
-- file-only message (no caption) is valid.
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists attachment_size bigint;

alter table public.messages alter column content set default '';

-- The original "content must be non-empty" check was defined inline without
-- an explicit name, so Postgres auto-named it messages_content_check.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages drop constraint if exists messages_content_or_attachment_check;
alter table public.messages add constraint messages_content_or_attachment_check
  check (char_length(trim(content)) > 0 or attachment_path is not null);
