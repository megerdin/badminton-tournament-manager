-- STAGING ROLLBACK DRAFT ONLY.
-- Review row counts and export categories before running. Dropping categories
-- deletes any category data migrated into this new table. Never run in production
-- until the cutover/rollback plan is approved and verified.
begin;
revoke all on function public.save_category_data(uuid,text,text,integer,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.replace_club_master(uuid,text,jsonb,jsonb) from public, anon, authenticated;
drop function if exists public.save_category_data(uuid,text,text,integer,jsonb,bigint);
drop function if exists public.replace_club_master(uuid,text,jsonb,jsonb);
drop table if exists public.categories;
-- Leave clubs.shared_data in place by default to avoid deleting any unrelated data.
-- Remove it only after verifying no other code has begun using it:
-- alter table public.clubs drop column if exists shared_data;
commit;
