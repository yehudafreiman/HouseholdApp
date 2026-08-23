-- Run this once to add the shopping wishlist.
-- Safe to re-run: idempotent.
--
-- A wishlist item is a normal shopping_items row with is_wishlist = true —
-- not a separate table — so "move to shopping" is a single UPDATE instead
-- of a delete+insert across two tables, and it keeps the same name,
-- category, quantity, and price it already had.

alter table public.shopping_items add column if not exists is_wishlist boolean not null default false;
