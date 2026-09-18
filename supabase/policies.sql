-- Badminton Tournament Manager
-- Major Step 8: production RLS and privileged approval functions
--
-- This script is designed to run after schema.sql.
-- The browser receives only publishable-key access. No service-role key belongs
-- in the application, repository, or browser configuration.

-- ------------------------------------------------------------
-- Privilege baseline
-- ------------------------------------------------------------
revoke all on table public.profiles from anon;
revoke all on table public.clubs from anon;
revoke all on table public.tournaments from anon;
revoke all on table public.tournament_members from anon;

revoke all on function public.handle_new_user() from public;

-- Remove broad table grants from authenticated. Policies then expose only the
-- operations explicitly required by the application.
revoke all on table public.profiles from authenticated;
revoke all on table public.clubs from authenticated;
revoke all on table public.tournaments from authenticated;
revoke all on table public.tournament_members from authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.clubs to authenticated;
grant select, insert, update, delete on public.tournaments to authenticated;
grant select, insert, update, delete on public.tournament_members to authenticated;

-- ------------------------------------------------------------
-- Private RLS helper functions
-- These are intentionally kept outside the exposed public schema so they are
-- not callable through the Data API as arbitrary RPC endpoints.
-- ------------------------------------------------------------
create schema if not exists private;

create or replace function private.is_approved_user()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.approval_status = 'approved');
$$;

create or replace function private.is_master_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'master_admin' and p.approval_status = 'approved');
$$;

create or replace function private.is_tournament_owner(p_tournament_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.tournaments t join public.clubs c on c.id=t.club_id where t.id=p_tournament_id and c.owner_id=auth.uid());
$$;

create or replace function private.has_tournament_role(p_tournament_id uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.is_tournament_owner(p_tournament_id)
  or exists (select 1 from public.tournament_members tm where tm.tournament_id=p_tournament_id and tm.user_id=auth.uid() and tm.role=any(p_roles));
$$;

revoke all on function private.is_approved_user() from public;
revoke all on function private.is_master_admin() from public;
revoke all on function private.is_tournament_owner(uuid) from public;
revoke all on function private.has_tournament_role(uuid,text[]) from public;
grant execute on function private.is_approved_user() to authenticated;
grant execute on function private.is_master_admin() to authenticated;
grant execute on function private.is_tournament_owner(uuid) to authenticated;
grant execute on function private.has_tournament_role(uuid,text[]) to authenticated;

-- Master-admins may update approval fields through the guarded RPC.
drop policy if exists profiles_update_master_admin on public.profiles;
create policy profiles_update_master_admin
on public.profiles
for update
to authenticated
using (private.is_master_admin())
with check (private.is_master_admin());

-- ------------------------------------------------------------
-- Master-admin approval RPC
-- Users cannot update role/approval_status directly.
-- ------------------------------------------------------------
create or replace function public.admin_set_approval(
  p_user_id uuid,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_master_admin() then
    raise exception 'not authorized';
  end if;

  if p_user_id = auth.uid() and p_status <> 'approved' then
    raise exception 'master admin cannot suspend or reject itself';
  end if;

  if p_status not in ('pending','approved','rejected','suspended') then
    raise exception 'invalid approval status';
  end if;

  update public.profiles
  set approval_status = p_status,
      approved_at = case when p_status = 'approved' then now() else approved_at end,
      approved_by = case when p_status = 'approved' then auth.uid() else approved_by end
  where id = p_user_id;

  if not found then
    raise exception 'target user not found';
  end if;
end;
$$;

revoke all on function public.admin_set_approval(uuid, text) from public;
grant execute on function public.admin_set_approval(uuid, text) to authenticated;


-- Protect role/approval fields from direct client updates.
create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     or new.approval_status is distinct from old.approval_status
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    if current_user <> 'postgres' and not private.is_master_admin() then
      raise exception 'profile security fields may only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_security_fields on public.profiles;
create trigger profiles_protect_security_fields
before update on public.profiles
for each row execute function public.protect_profile_security_fields();

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
on public.profiles for select to authenticated
using (id = auth.uid() or private.is_master_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ------------------------------------------------------------
-- Clubs
-- ------------------------------------------------------------
drop policy if exists clubs_select_owner on public.clubs;
create policy clubs_select_owner
on public.clubs for select to authenticated
using (owner_id = auth.uid() or private.is_master_admin());

drop policy if exists clubs_insert_approved on public.clubs;
create policy clubs_insert_approved
on public.clubs for insert to authenticated
with check (private.is_approved_user() and owner_id = auth.uid());

drop policy if exists clubs_update_owner on public.clubs;
create policy clubs_update_owner
on public.clubs for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists clubs_delete_owner on public.clubs;
create policy clubs_delete_owner
on public.clubs for delete to authenticated
using (owner_id = auth.uid());

-- ------------------------------------------------------------
-- Tournaments
-- ------------------------------------------------------------
drop policy if exists tournaments_select_access on public.tournaments;
create policy tournaments_select_access
on public.tournaments for select to authenticated
using (private.has_tournament_role(id,array['viewer','editor','owner']) or private.is_master_admin());

drop policy if exists tournaments_insert_owner on public.tournaments;
create policy tournaments_insert_owner
on public.tournaments for insert to authenticated
with check (private.is_approved_user() and exists (select 1 from public.clubs c where c.id=tournaments.club_id and c.owner_id=auth.uid()));

drop policy if exists tournaments_update_access on public.tournaments;
create policy tournaments_update_access
on public.tournaments for update to authenticated
using (private.has_tournament_role(id,array['editor','owner']) or private.is_master_admin())
with check (private.has_tournament_role(id,array['editor','owner']) or private.is_master_admin());

drop policy if exists tournaments_delete_owner on public.tournaments;
create policy tournaments_delete_owner
on public.tournaments for delete to authenticated
using (private.has_tournament_role(id,array['owner']) or private.is_master_admin());

-- ------------------------------------------------------------
-- Tournament members
-- ------------------------------------------------------------
drop policy if exists tournament_members_select_access on public.tournament_members;
create policy tournament_members_select_access
on public.tournament_members for select to authenticated
using (user_id=auth.uid() or private.is_tournament_owner(tournament_id) or private.is_master_admin());

drop policy if exists tournament_members_insert_owner on public.tournament_members;
create policy tournament_members_insert_owner
on public.tournament_members for insert to authenticated
with check (private.is_approved_user() and (private.is_tournament_owner(tournament_id) or private.is_master_admin()));

drop policy if exists tournament_members_update_owner on public.tournament_members;
create policy tournament_members_update_owner
on public.tournament_members for update to authenticated
using (private.is_tournament_owner(tournament_id) or private.is_master_admin())
with check (private.is_tournament_owner(tournament_id) or private.is_master_admin());

drop policy if exists tournament_members_delete_owner on public.tournament_members;
create policy tournament_members_delete_owner
on public.tournament_members for delete to authenticated
using (private.is_tournament_owner(tournament_id) or private.is_master_admin());

-- ------------------------------------------------------------
-- RLS remains enabled explicitly, even if this script is rerun.
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
