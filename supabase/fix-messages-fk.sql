-- Run this once to fix "messages don't show up" caused by messages.user_id
-- pointing at auth.users instead of public.profiles (PostgREST needs an FK
-- to public.profiles to embed profiles(username) in a select).
alter table public.messages drop constraint messages_user_id_fkey;
alter table public.messages
  add constraint messages_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
