-- Badminton Tournament Manager — category-scoped persistence (STAGING DRAFT)
-- Additive only: does not modify/drop public.tournaments or migrate production data.
-- Requires existing public.clubs/public.profiles and private.is_approved_user(),
-- private.is_master_admin(), private.is_club_owner(uuid) from policies.sql.

begin;

alter table public.clubs
  add column if not exists shared_data jsonb not null default '{}'::jsonb;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  legacy_category_id text not null,
  name text not null,
  sort_order integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (club_id, legacy_category_id)
);

create index if not exists categories_club_sort_idx
  on public.categories(club_id, sort_order, created_at);

alter table public.categories enable row level security;
revoke all on table public.categories from anon, authenticated;
grant select on table public.categories to authenticated;

drop policy if exists categories_select_owner on public.categories;
create policy categories_select_owner on public.categories
for select to authenticated
using ((private.is_approved_user() and private.is_club_owner(club_id)) or private.is_master_admin());

-- Atomic optimistic save. A revision mismatch returns the current server row;
-- the client may automatically retry its intended local category payload.
create or replace function public.save_category_data(
  p_club_id uuid,
  p_legacy_category_id text,
  p_name text,
  p_sort_order integer,
  p_data jsonb,
  p_expected_revision bigint default 0
) returns jsonb
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare v_row public.categories%rowtype;
begin
  if auth.uid() is null or not private.is_approved_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (private.is_club_owner(p_club_id) or private.is_master_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_legacy_category_id,'')), '') is null
     or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid category payload' using errcode = '22023';
  end if;

  -- Serialize category writes against full-master replacement for this club.
  -- Clubs have low write volume; a shared lock avoids category-save/import races.
  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text, 0));
  select * into v_row from public.categories
    where club_id=p_club_id and legacy_category_id=p_legacy_category_id for update;

  if not found then
    if coalesce(p_expected_revision,0) not in (0) then
      return jsonb_build_object('status','conflict','revision',0,'data',null);
    end if;
    insert into public.categories(club_id,legacy_category_id,name,sort_order,data,revision,updated_by)
    values(p_club_id,p_legacy_category_id,coalesce(nullif(trim(p_name),''),'Category'),coalesce(p_sort_order,0),p_data,1,auth.uid())
    returning * into v_row;
    return jsonb_build_object('status','saved','revision',v_row.revision,'data',v_row.data,'id',v_row.id);
  end if;

  if coalesce(p_expected_revision,0) <> v_row.revision then
    return jsonb_build_object('status','conflict','revision',v_row.revision,'data',v_row.data,'id',v_row.id);
  end if;

  update public.categories set
    name=coalesce(nullif(trim(p_name),''),'Category'),
    sort_order=coalesce(p_sort_order,0),
    data=p_data,
    revision=v_row.revision+1,
    updated_at=now(),
    updated_by=auth.uid()
  where id=v_row.id returning * into v_row;
  return jsonb_build_object('status','saved','revision',v_row.revision,'data',v_row.data,'id',v_row.id);
end;
$$;

-- Whole-master import/replace is a distinct, transactional operation.
-- Omitted categories are intentionally deleted only in this explicit RPC.
create or replace function public.replace_club_master(
  p_club_id uuid,
  p_club_name text,
  p_shared_data jsonb,
  p_categories jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare v_item jsonb; v_id text; v_name text; v_order integer; v_data jsonb; v_count integer := 0;
begin
  if auth.uid() is null or not private.is_approved_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (private.is_club_owner(p_club_id) or private.is_master_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_categories,'null'::jsonb)) <> 'array' then
    raise exception 'categories must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_categories)=0 then
    raise exception 'at least one category is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_shared_data,'{}'::jsonb)) <> 'object' then
    raise exception 'shared data must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_categories) e
    where nullif(trim(coalesce(e->>'id','')),'') is null
       or coalesce(jsonb_typeof(e->'data'),'null') <> 'object'
  ) then
    raise exception 'each category requires id and object data' using errcode = '22023';
  end if;
  if (select count(distinct e->>'id') from jsonb_array_elements(p_categories) e)
     <> jsonb_array_length(p_categories) then
    raise exception 'duplicate category id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text, 0));
  update public.clubs set name=coalesce(nullif(trim(p_club_name),''),'Your club name'),
    shared_data=coalesce(p_shared_data,'{}'::jsonb) || jsonb_build_object('categoryPersistenceVersion',1), updated_at=now()
    where id=p_club_id;
  if not found then raise exception 'club not found' using errcode = 'P0002'; end if;

  for v_item in select value from jsonb_array_elements(p_categories) loop
    v_id := v_item->>'id';
    v_name := coalesce(nullif(trim(v_item->>'name'),''),'Category');
    v_order := coalesce(nullif(v_item->>'sortOrder','')::integer, v_count);
    v_data := v_item->'data';
    insert into public.categories(club_id,legacy_category_id,name,sort_order,data,revision,updated_by)
    values(p_club_id,v_id,v_name,v_order,v_data,1,auth.uid())
    on conflict (club_id,legacy_category_id) do update set
      name=excluded.name, sort_order=excluded.sort_order, data=excluded.data,
      revision=categories.revision+1, updated_at=now(), updated_by=auth.uid();
    v_count := v_count+1;
  end loop;

  delete from public.categories c
    where c.club_id=p_club_id
      and not exists (select 1 from jsonb_array_elements(p_categories) e where e->>'id'=c.legacy_category_id);
  return jsonb_build_object('status','replaced','category_count',v_count);
end;
$$;

-- Routine metadata saves must never create or remove the migration-complete marker.
-- The marker is owned exclusively by replace_club_master after a complete category set is written.
create or replace function public.save_club_metadata(
  p_club_id uuid,
  p_club_name text,
  p_shared_data jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare v_club public.clubs%rowtype; v_shared jsonb;
begin
  if auth.uid() is null or not private.is_approved_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (private.is_club_owner(p_club_id) or private.is_master_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_shared_data,'{}'::jsonb)) <> 'object' then
    raise exception 'shared data must be an object' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text, 0));
  select * into v_club from public.clubs where id=p_club_id for update;
  if not found then raise exception 'club not found' using errcode = 'P0002'; end if;
  v_shared := coalesce(p_shared_data,'{}'::jsonb) - 'categoryPersistenceVersion';
  if v_club.shared_data ? 'categoryPersistenceVersion' then
    v_shared := v_shared || jsonb_build_object('categoryPersistenceVersion',v_club.shared_data->'categoryPersistenceVersion');
  end if;
  update public.clubs set
    name=coalesce(nullif(trim(p_club_name),''),'Your club name'),
    shared_data=v_shared,
    updated_at=now()
  where id=p_club_id returning * into v_club;
  return jsonb_build_object('status','saved','club',jsonb_build_object('id',v_club.id,'name',v_club.name,'shared_data',v_club.shared_data));
end;
$$;

revoke all on function public.save_category_data(uuid,text,text,integer,jsonb,bigint) from public, anon;
revoke all on function public.replace_club_master(uuid,text,jsonb,jsonb) from public, anon;
revoke all on function public.save_club_metadata(uuid,text,jsonb) from public, anon;
grant execute on function public.save_category_data(uuid,text,text,integer,jsonb,bigint) to authenticated;
grant execute on function public.replace_club_master(uuid,text,jsonb,jsonb) to authenticated;
grant execute on function public.save_club_metadata(uuid,text,jsonb) to authenticated;

commit;
