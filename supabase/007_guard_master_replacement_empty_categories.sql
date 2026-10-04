-- Protect populated categories from stale full-master snapshots.
-- Explicit JSON import and Reset All may intentionally clear data; routine
-- category-list replacements may not silently empty an existing category.
begin;
create or replace function public.replace_club_master(
  p_club_id uuid, p_club_name text, p_shared_data jsonb, p_categories jsonb
) returns jsonb
language plpgsql security definer
set search_path to public, private, pg_temp
as $function$
declare
  v_item jsonb;
  v_id text;
  v_name text;
  v_order integer;
  v_data jsonb;
  v_count integer := 0;
  v_existing public.categories%rowtype;
  v_allow_empty_overwrite boolean := false;
begin
  if auth.uid() is null or not private.is_approved_user() then raise exception 'not authorized' using errcode = '42501'; end if;
  if not (private.is_club_owner(p_club_id) or private.is_master_admin()) then raise exception 'not authorized' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_categories,'null'::jsonb)) <> 'array' then raise exception 'categories must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_categories)=0 then raise exception 'at least one category is required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_shared_data,'{}'::jsonb)) <> 'object' then raise exception 'shared data must be an object' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_categories) e where nullif(trim(coalesce(e->>'id','')),'') is null or coalesce(jsonb_typeof(e->'data'),'null') <> 'object') then raise exception 'each category requires id and object data' using errcode = '22023'; end if;
  if (select count(distinct e->>'id') from jsonb_array_elements(p_categories) e) <> jsonb_array_length(p_categories) then raise exception 'duplicate category id' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text, 0));
  v_allow_empty_overwrite := coalesce((p_shared_data->>'allowEmptyOverwrite')::boolean, false);
  if not v_allow_empty_overwrite then
    for v_item in select value from jsonb_array_elements(p_categories) loop
      v_id := v_item->>'id'; v_data := v_item->'data';
      select * into v_existing from public.categories where club_id=p_club_id and legacy_category_id=v_id for update;
      if found and (
        jsonb_array_length(coalesce(v_existing.data->'teams','[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(v_existing.data->'players','[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(v_existing.data->'groups','[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(v_existing.data->'fixtures','[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(v_existing.data->'results','[]'::jsonb)) > 0
        or (jsonb_typeof(v_existing.data->'preliminaryRound')='object' and v_existing.data->'preliminaryRound'<>'{}'::jsonb)
      ) and (
        jsonb_array_length(coalesce(v_data->'teams','[]'::jsonb)) = 0
        and jsonb_array_length(coalesce(v_data->'players','[]'::jsonb)) = 0
        and jsonb_array_length(coalesce(v_data->'groups','[]'::jsonb)) = 0
        and jsonb_array_length(coalesce(v_data->'fixtures','[]'::jsonb)) = 0
        and jsonb_array_length(coalesce(v_data->'results','[]'::jsonb)) = 0
        and (coalesce(v_data->'preliminaryRound','null'::jsonb)='null'::jsonb or v_data->'preliminaryRound'='{}'::jsonb)
      ) then raise exception 'refusing full-master replacement that would erase populated category %; use an explicit import or Reset All action', v_id using errcode = '22023'; end if;
    end loop;
  end if;
  update public.clubs set
    name=coalesce(nullif(trim(p_club_name),''),'Your club name'),
    shared_data=(coalesce(p_shared_data,'{}'::jsonb) - 'allowEmptyOverwrite') || jsonb_build_object('categoryPersistenceVersion',1),
    updated_at=now()
  where id=p_club_id;
  if not found then raise exception 'club not found' using errcode = 'P0002'; end if;
  for v_item in select value from jsonb_array_elements(p_categories) loop
    v_id:=v_item->>'id'; v_name:=coalesce(nullif(trim(v_item->>'name'),''),'Category');
    v_order:=coalesce(nullif(v_item->>'sortOrder','')::integer,v_count); v_data:=v_item->'data';
    insert into public.categories(club_id,legacy_category_id,name,sort_order,data,revision,updated_by)
    values(p_club_id,v_id,v_name,v_order,v_data,1,auth.uid())
    on conflict (club_id,legacy_category_id) do update set
      name=excluded.name,sort_order=excluded.sort_order,data=excluded.data,
      revision=categories.revision+1,updated_at=now(),updated_by=auth.uid();
    v_count:=v_count+1;
  end loop;
  delete from public.categories c where c.club_id=p_club_id
    and not exists (select 1 from jsonb_array_elements(p_categories) e where e->>'id'=c.legacy_category_id);
  return jsonb_build_object('status','replaced','category_count',v_count);
end;
$function$;
revoke all on function public.replace_club_master(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.replace_club_master(uuid,text,jsonb,jsonb) to authenticated;
commit;
