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
-- Security-definer identity helpers
-- These functions bypass RLS only for their narrowly scoped lookup.
-- The search_path is pinned to avoid object-shadowing attacks.
-- ------------------------------------------------------------
create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.approval_status = 'approved'
  );
$$;

create or replace function public.is_master_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'master_admin'
      and p.approval_status = 'approved'
  );
$$;

revoke all on function public.is_approved_user() from public;
revoke all on function public.is_master_admin() from public;
grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.is_master_admin() to authenticated;

create or replace function public.is_tournament_owner(target_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tournaments t
    join public.clubs c on c.id = t.club_id
    where t.id = target_tournament_id
      and c.owner_id = auth.uid()
  );
$$;

create or replace function public.has_tournament_role(
  target_tournament_id uuid,
  allowed_roles public.tournament_member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tournament_members tm
    where tm.tournament_id = target_tournament_id
      and tm.user_id = auth.uid()
      and tm.role = any(allowed_roles)
  );
$$;

revoke all on function public.is_tournament_owner(uuid) from public;
revoke all on function public.has_tournament_role(uuid, public.tournament_member_role[]) from public;
grant execute on function public.is_tournament_owner(uuid) to authenticated;
grant execute on function public.has_tournament_role(uuid, public.tournament_member_role[]) to authenticated;

-- ------------------------------------------------------------
-- Master-admin approval RPC
-- Users cannot update role/approval_status directly.
-- ------------------------------------------------------------
create or replace function public.admin_set_approval(
  target_user_id uuid,
  new_status public.approval_status
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_master_admin() then
    raise exception 'not authorized';
  end if;

  if target_user_id = auth.uid() and new_status <> 'approved' then
    raise exception 'master admin cannot suspend or reject itself';
  end if;

  update public.profiles
  set approval_status = new_status,
      approved_at = case when new_status = 'approved' then now() else approved_at end,
      approved_by = case when new_status = 'approved' then auth.uid() else approved_by end
  where id = target_user_id;

  if not found then
    raise exception 'target user not found';
  end if;
end;
$$;

revoke all on function public.admin_set_approval(uuid, public.approval_status) from public;
grant execute on function public.admin_set_approval(uuid, public.approval_status) to authenticated;

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------
drop policy if exists profiles_select_visible on public.profiles;
create policy profiles_select_visible
on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.is_master_admin()
);

-- There is intentionally NO INSERT/UPDATE/DELETE policy for profiles.
-- New profiles are created by the auth trigger; role/status changes use the
-- admin RPC above. This prevents self-approval and self-role escalation.

-- ------------------------------------------------------------
-- Clubs
-- ------------------------------------------------------------
drop policy if exists clubs_owner_all on public.clubs;
create policy clubs_owner_all
on public.clubs
for all to authenticated
using (
  public.is_approved_user()
  and owner_id = auth.uid()
)
with check (
  public.is_approved_user()
  and owner_id = auth.uid()
);

-- ------------------------------------------------------------
-- Tournaments
-- ------------------------------------------------------------
drop policy if exists tournaments_select_member_or_owner on public.tournaments;
create policy tournaments_select_member_or_owner
on public.tournaments
for select to authenticated
using (
  public.is_approved_user()
  and (
    public.is_tournament_owner(tournaments.id)
    or public.has_tournament_role(tournaments.id, array['owner','editor','viewer']::public.tournament_member_role[])
  )
);

drop policy if exists tournaments_insert_owner on public.tournaments;
create policy tournaments_insert_owner
on public.tournaments
for insert to authenticated
with check (
  public.is_approved_user()
  and exists (
    select 1 from public.clubs c
    where c.id = tournaments.club_id
      and c.owner_id = auth.uid()
  )
  and updated_by = auth.uid()
);

drop policy if exists tournaments_update_owner_or_editor on public.tournaments;
create policy tournaments_update_owner_or_editor
on public.tournaments
for update to authenticated
using (
  public.is_approved_user()
  and (
    public.is_tournament_owner(tournaments.id)
    or public.has_tournament_role(tournaments.id, array['owner','editor']::public.tournament_member_role[])
  )
)
with check (
  public.is_approved_user()
  and (
    public.is_tournament_owner(tournaments.id)
    or public.has_tournament_role(tournaments.id, array['owner','editor']::public.tournament_member_role[])
  )
  and updated_by = auth.uid()
  and version >= 1
);

drop policy if exists tournaments_delete_owner on public.tournaments;
create policy tournaments_delete_owner
on public.tournaments
for delete to authenticated
using (
  public.is_approved_user()
  and exists (
    select 1 from public.clubs c
    where c.id = tournaments.club_id
      and c.owner_id = auth.uid()
  )
);

-- ------------------------------------------------------------
-- Tournament members
-- ------------------------------------------------------------
drop policy if exists tournament_members_select_visible on public.tournament_members;
create policy tournament_members_select_visible
on public.tournament_members
for select to authenticated
using (
  public.is_approved_user()
  and (
    user_id = auth.uid()
    or exists (
      select 1
      from public.tournaments t
      join public.clubs c on c.id = t.club_id
      where t.id = tournament_members.tournament_id
        and c.owner_id = auth.uid()
    )
  )
);

drop policy if exists tournament_members_insert_owner on public.tournament_members;
create policy tournament_members_insert_owner
on public.tournament_members
for insert to authenticated
with check (
  public.is_approved_user()
  and public.is_tournament_owner(tournament_members.tournament_id)
);

drop policy if exists tournament_members_update_owner on public.tournament_members;
create policy tournament_members_update_owner
on public.tournament_members
for update to authenticated
using (
  public.is_approved_user()
  and public.is_tournament_owner(tournament_members.tournament_id)
)
with check (
  public.is_approved_user()
  and public.is_tournament_owner(tournament_members.tournament_id)
);

drop policy if exists tournament_members_delete_owner on public.tournament_members;
create policy tournament_members_delete_owner
on public.tournament_members
for delete to authenticated
using (
  public.is_approved_user()
  and public.is_tournament_owner(tournament_members.tournament_id)
);

-- ------------------------------------------------------------
-- RLS remains enabled explicitly, even if this script is rerun.
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_members enable row level security;
