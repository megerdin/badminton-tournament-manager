-- Badminton Tournament Manager V6.0.2
-- Upgrade an existing Badminton Supabase database to the V6 Club/Category model.
-- Non-destructive: existing profiles and existing Club/Category rows are preserved.

alter table public.clubs
  add column if not exists shared_settings jsonb not null default '{}'::jsonb,
  add column if not exists version bigint not null default 1;

update public.clubs
set shared_settings = coalesce(shared_data, '{}'::jsonb)
where shared_settings = '{}'::jsonb
  and shared_data is not null;

alter table public.categories
  add column if not exists category_key text,
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists sort_order integer not null default 0;

update public.categories
set category_key = coalesce(nullif(legacy_category_id,''), id::text)
where category_key is null or category_key='';

create unique index if not exists uq_categories_club_category_key
  on public.categories(club_id, category_key);

create unique index if not exists uq_clubs_one_owner
  on public.clubs(owner_id);

drop trigger if exists clubs_set_updated_at on public.clubs;
create trigger clubs_set_updated_at
before update on public.clubs for each row execute function public.set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
before update on public.categories for each row execute function public.set_updated_at();
