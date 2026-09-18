-- Badminton Tournament Manager
-- Major Step 8: production database schema
--
-- This script creates the complete application data model used by the browser.
-- It does NOT migrate the old browser LocalStorage data.
-- Run once in the Supabase SQL editor for a fresh project.

create extension if not exists pgcrypto;

do $$ begin
  create type public.profile_role as enum ('user', 'master_admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tournament_member_role as enum ('owner', 'editor', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role public.profile_role not null default 'user',
  approval_status public.approval_status not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Your club name',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null default 'Badminton Tournament Manager',
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.tournament_members (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.tournament_member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create unique index if not exists uq_clubs_one_owner on public.clubs(owner_id);
create unique index if not exists uq_tournaments_one_primary_per_club on public.tournaments(club_id);
create index if not exists idx_tournaments_club_id on public.tournaments(club_id);
create index if not exists idx_tournament_members_user_id on public.tournament_members(user_id);
create index if not exists idx_profiles_approval_status on public.profiles(approval_status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists clubs_set_updated_at on public.clubs;
create trigger clubs_set_updated_at
before update on public.clubs
for each row execute function public.set_updated_at();

drop trigger if exists tournaments_set_updated_at on public.tournaments;
create trigger tournaments_set_updated_at
before update on public.tournaments
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Existing profiles, if this script is being applied to a database that already
-- contains Auth users, are backfilled without changing approval or role.
insert into public.profiles (id, email, display_name)
select u.id,
       u.email,
       nullif(trim(coalesce(u.raw_user_meta_data->>'display_name', '')), '')
from auth.users u
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
