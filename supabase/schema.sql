-- Badminton Tournament Manager V6.0.2
-- Data model: Club (shared) -> Categories (independent competition data)
-- Existing tournament JSON data is intentionally NOT migrated.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  club_name text,
  city text,
  role text not null default 'user' check (role in ('user','master_admin')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','suspended')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null
);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Your club name',
  shared_settings jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'editor' check (role in ('viewer','editor','owner')),
  created_at timestamptz not null default now(),
  primary key (club_id,user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  category_key text not null,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id,category_key)
);

create unique index if not exists uq_clubs_one_owner on public.clubs(owner_id);
create index if not exists idx_club_members_user_id on public.club_members(user_id);
create index if not exists idx_categories_club_id on public.categories(club_id,sort_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists clubs_set_updated_at on public.clubs;
create trigger clubs_set_updated_at before update on public.clubs for each row execute function public.set_updated_at();
drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id,email,display_name,club_name,city)
  values(new.id,new.email,nullif(trim(coalesce(new.raw_user_meta_data->>'display_name','')),''),nullif(trim(coalesce(new.raw_user_meta_data->>'club_name','')),''),nullif(trim(coalesce(new.raw_user_meta_data->>'city','')),''))
  on conflict(id) do update set email=excluded.email;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles(id,email,display_name,club_name,city)
select u.id,u.email,nullif(trim(coalesce(u.raw_user_meta_data->>'display_name','')),''),nullif(trim(coalesce(u.raw_user_meta_data->>'club_name','')), ''),nullif(trim(coalesce(u.raw_user_meta_data->>'city','')), '')
from auth.users u on conflict(id) do nothing;

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.categories enable row level security;
