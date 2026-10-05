-- Badminton Tournament Manager V6.1.4
-- Fixes PostgreSQL ambiguity in the V6.1 save RPC and preserves the
-- legacy categories.legacy_category_id NOT NULL column used by older DBs.

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
  if not private.is_approved_user() then raise exception 'not authorized'; end if;
  v_club_id:=p_club_id;
  if v_club_id is null then
    insert into public.clubs(owner_id,name,shared_settings,version)
    values(auth.uid(),coalesce(nullif(trim(p_name),''),'Your club name'),coalesce(p_shared_settings,'{}'::jsonb),1)
    returning id,clubs.version into v_club_id,v_version;
    insert into public.club_members(club_id,user_id,role)
    values(v_club_id,auth.uid(),'owner')
    on conflict on constraint club_members_pkey do update set role='owner';
  else
    if not private.is_club_member(v_club_id,array['editor','owner']) and not private.is_master_admin() then raise exception 'not authorized'; end if;
    select c.version into v_version from public.clubs as c where c.id=v_club_id for update;
    if not found then raise exception 'club not found'; end if;
    v_version:=coalesce(v_version,1)+1;
    update public.clubs as c
    set name=coalesce(nullif(trim(p_name),''),'Your club name'),shared_settings=coalesce(p_shared_settings,'{}'::jsonb),version=v_version,updated_at=now()
    where c.id=v_club_id;
  end if;
  delete from public.categories as cat where cat.club_id=v_club_id;
  for item in select value from jsonb_array_elements(coalesce(p_categories,'[]'::jsonb)) loop
    v_key:=coalesce(nullif(item->>'id',''),gen_random_uuid()::text);
    v_name:=coalesce(nullif(trim(item->>'name'),''),'Category');
    v_settings:=coalesce(item->'settings','{}'::jsonb);
    v_data:=coalesce(item->'data','{}'::jsonb);
    v_order:=coalesce((item->>'sort_order')::integer,0);
    insert into public.categories(club_id,legacy_category_id,category_key,name,settings,data,sort_order)
    values(v_club_id,v_key,v_key,v_name,v_settings,v_data,v_order);
  end loop;
  return query select v_version,v_club_id;
end;
$$;

revoke all on function public.save_club_snapshot(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.save_club_snapshot(uuid,text,jsonb,jsonb) to authenticated;
