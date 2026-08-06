-- Run this once to fix "permission denied for table profiles/messages" errors.
grant select, update on public.profiles to authenticated;
grant select, insert on public.messages to authenticated;
