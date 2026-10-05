-- Badminton Tournament Manager V6.0.2 RLS + atomic cloud save

revoke all on table public.clubs from anon;
revoke all on table public.club_members from anon;
revoke all on table public.categories from anon;
revoke all on table public.profiles from anon;

grant select,insert,update,delete on public.clubs to authenticated;
grant select,insert,update,delete on public.club_members to authenticated;
grant select,insert,update,delete on public.categories to authenticated;
grant select on public.profiles to authenticated;

-- Private authorization helpers.
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create or replace function private.is_approved_user()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and approval_status='approved');
$$;
create or replace function private.is_master_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='master_admin' and approval_status='approved');
$$;
create or replace function private.is_club_member(p_club_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.clubs c where c.id=p_club_id and c.owner_id=auth.uid())
      or exists(select 1 from public.club_members m where m.club_id=p_club_id and m.user_id=auth.uid() and m.role=any(p_roles));
$$;
revoke all on function private.is_approved_user() from public;
revoke all on function private.is_master_admin() from public;
revoke all on function private.is_club_member(uuid,text[]) from public;
grant execute on function private.is_approved_user() to authenticated;
grant execute on function private.is_master_admin() to authenticated;
grant execute on function private.is_club_member(uuid,text[]) to authenticated;


-- Profiles.
drop policy if exists profiles_select_access on public.profiles;
create policy profiles_select_access on public.profiles for select to authenticated using(id=auth.uid() or private.is_master_admin());

-- Clubs.
drop policy if exists clubs_select_access on public.clubs;
create policy clubs_select_access on public.clubs for select to authenticated
using(owner_id=auth.uid() or private.is_club_member(id,array['viewer','editor','owner']) or private.is_master_admin());
drop policy if exists clubs_insert_approved on public.clubs;
create policy clubs_insert_approved on public.clubs for insert to authenticated
with check(private.is_approved_user() and owner_id=auth.uid());
drop policy if exists clubs_update_access on public.clubs;
create policy clubs_update_access on public.clubs for update to authenticated
using(private.is_club_member(id,array['editor','owner']) or private.is_master_admin())
with check(private.is_club_member(id,array['editor','owner']) or private.is_master_admin());
drop policy if exists clubs_delete_owner on public.clubs;
create policy clubs_delete_owner on public.clubs for delete to authenticated
using(owner_id=auth.uid() or private.is_master_admin());

-- Club membership.
drop policy if exists club_members_select_access on public.club_members;
create policy club_members_select_access on public.club_members for select to authenticated
using(user_id=auth.uid() or private.is_club_member(club_id,array['owner']) or private.is_master_admin());
drop policy if exists club_members_insert_owner on public.club_members;
create policy club_members_insert_owner on public.club_members for insert to authenticated
with check(private.is_approved_user() and (private.is_club_member(club_id,array['owner']) or private.is_master_admin()));
drop policy if exists club_members_update_owner on public.club_members;
create policy club_members_update_owner on public.club_members for update to authenticated
using(private.is_club_member(club_id,array['owner']) or private.is_master_admin())
with check(private.is_club_member(club_id,array['owner']) or private.is_master_admin());
drop policy if exists club_members_delete_owner on public.club_members;
create policy club_members_delete_owner on public.club_members for delete to authenticated
using(private.is_club_member(club_id,array['owner']) or private.is_master_admin());

-- Categories.
drop policy if exists categories_select_access on public.categories;
create policy categories_select_access on public.categories for select to authenticated
using(private.is_club_member(club_id,array['viewer','editor','owner']) or private.is_master_admin());
drop policy if exists categories_insert_access on public.categories;
create policy categories_insert_access on public.categories for insert to authenticated
with check(private.is_approved_user() and (private.is_club_member(club_id,array['editor','owner']) or private.is_master_admin()));
drop policy if exists categories_update_access on public.categories;
create policy categories_update_access on public.categories for update to authenticated
using(private.is_club_member(club_id,array['editor','owner']) or private.is_master_admin())
with check(private.is_club_member(club_id,array['editor','owner']) or private.is_master_admin());
drop policy if exists categories_delete_access on public.categories;
create policy categories_delete_access on public.categories for delete to authenticated
using(private.is_club_member(club_id,array['editor','owner']) or private.is_master_admin());

alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.categories enable row level security;

-- Badminton Tournament Manager V6.1.0
-- Create-or-replace cloud save.
-- First save creates the Club and owner membership atomically.
-- Existing Club saves replace the complete shared/category snapshot.

drop function if exists public.save_club_snapshot(uuid,text,jsonb,jsonb);

create or replace function public.save_club_snapshot(
  p_club_id uuid,
  p_name text,
  p_shared_settings jsonb,
  p_categories jsonb
)
returns table(version bigint, club_id uuid)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_version bigint;
  v_club_id uuid;
  item jsonb;
  v_key text;
  v_name text;
  v_settings jsonb;
  v_data jsonb;
  v_order integer;
begin
  if not private.is_approved_user() then
    raise exception 'not authorized';
  end if;

  v_club_id := p_club_id;

  if v_club_id is null then
    insert into public.clubs(owner_id,name,shared_settings,version)
    values(
      auth.uid(),
      coalesce(nullif(trim(p_name),''),'Your club name'),
      coalesce(p_shared_settings,'{}'::jsonb),
      1
    )
    returning id, version into v_club_id, v_version;

    insert into public.club_members(club_id,user_id,role)
    values(v_club_id,auth.uid(),'owner')
    on conflict (club_id,user_id) do update set role='owner';
  else
    if not private.is_club_member(v_club_id,array['editor','owner'])
       and not private.is_master_admin() then
      raise exception 'not authorized';
    end if;

    select c.version
      into v_version
      from public.clubs c
     where c.id=v_club_id
     for update;

    if not found then
      raise exception 'club not found';
    end if;

    v_version := coalesce(v_version,1)+1;

    update public.clubs
       set name=coalesce(nullif(trim(p_name),''),'Your club name'),
           shared_settings=coalesce(p_shared_settings,'{}'::jsonb),
           version=v_version,
           updated_at=now()
     where id=v_club_id;
  end if;

  delete from public.categories where club_id=v_club_id;

  for item in
    select value
      from jsonb_array_elements(coalesce(p_categories,'[]'::jsonb))
  loop
    v_key := coalesce(nullif(item->>'id',''),gen_random_uuid()::text);
    v_name := coalesce(nullif(trim(item->>'name'),''),'Category');
    v_settings := coalesce(item->'settings','{}'::jsonb);
    v_data := coalesce(item->'data','{}'::jsonb);
    v_order := coalesce((item->>'sort_order')::integer,0);

    insert into public.categories(
      club_id,category_key,name,settings,data,sort_order
    )
    values(
      v_club_id,v_key,v_name,v_settings,v_data,v_order
    );
  end loop;

  return query select v_version, v_club_id;
end;
$$;

revoke all on function public.save_club_snapshot(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_club_snapshot(uuid,text,jsonb,jsonb) to authenticated;

-- Existing approved club owners can be made club owners explicitly after this
-- schema is installed. New clubs should insert the owner membership from the app.

-- Master-admin approval and account deletion RPCs.
create or replace function public.admin_set_approval(p_user_id uuid,p_status text)
returns void language plpgsql security invoker set search_path=public,private,pg_temp as $$
begin
  if not private.is_master_admin() then raise exception 'not authorized'; end if;
  if p_user_id=auth.uid() and p_status<>'approved' then raise exception 'master admin cannot suspend or reject itself'; end if;
  if p_status not in ('pending','approved','rejected','suspended') then raise exception 'invalid approval status'; end if;
  update public.profiles set approval_status=p_status,approved_at=case when p_status='approved' then now() else approved_at end,approved_by=case when p_status='approved' then auth.uid() else approved_by end where id=p_user_id;
  if not found then raise exception 'user not found'; end if;
end;
$$;
revoke all on function public.admin_set_approval(uuid,text) from public,anon;
grant execute on function public.admin_set_approval(uuid,text) to authenticated;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='master_admin' and approval_status='approved') then raise exception 'not authorized'; end if;
  if p_user_id=auth.uid() then raise exception 'administrator cannot delete itself'; end if;
  delete from auth.users where id=p_user_id;
  if not found then raise exception 'target user not found'; end if;
end;
$$;
revoke all on function public.admin_delete_user(uuid) from public,anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
