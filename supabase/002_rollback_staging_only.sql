-- DESTRUCTIVE STAGING ROLLBACK ONLY. NEVER RUN AGAINST THE MAIN PROJECT.
-- The category-persistence schema is installed on the main project. This file
-- is only for an isolated test project after exporting any category data.
-- Dropping categories permanently deletes all data stored in that table.
begin;
revoke all on function public.save_category_data(uuid,text,text,integer,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.replace_club_master(uuid,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.save_club_metadata(uuid,text,jsonb) from public, anon, authenticated;
drop function if exists public.save_category_data(uuid,text,text,integer,jsonb,bigint);
drop function if exists public.replace_club_master(uuid,text,jsonb,jsonb);
drop function if exists public.save_club_metadata(uuid,text,jsonb);
drop table if exists public.categories;
-- Leave clubs.shared_data in place by default to avoid deleting any unrelated data.
-- Remove it only after verifying no other code has begun using it:
-- alter table public.clubs drop column if exists shared_data;
commit;
