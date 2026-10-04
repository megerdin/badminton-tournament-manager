-- Prevent ordinary category saves from silently erasing an entire populated
-- category. Full replacement/import remains a separate explicit operation.
-- Additive and data-preserving: this function does not modify existing rows.
begin;

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

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text, 0));
  select * into v_row from public.categories
    where club_id=p_club_id and legacy_category_id=p_legacy_category_id for update;

  if not found then
    if coalesce(p_expected_revision,0) <> 0 then
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

  -- A normal Save may legitimately update individual lists, but an incoming
  -- payload that has no competition records at all must not erase a category
  -- that currently contains competition data. Intentional full imports use
  -- replace_club_master and remain explicit. This guard is evaluated under the
  -- same row lock as the revision check, so it cannot race another category save.
  if jsonb_array_length(coalesce(v_row.data->'teams','[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(v_row.data->'players','[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(v_row.data->'groups','[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(v_row.data->'fixtures','[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(v_row.data->'results','[]'::jsonb)) > 0 then
    if jsonb_array_length(coalesce(p_data->'teams','[]'::jsonb)) = 0
       and jsonb_array_length(coalesce(p_data->'players','[]'::jsonb)) = 0
       and jsonb_array_length(coalesce(p_data->'groups','[]'::jsonb)) = 0
       and jsonb_array_length(coalesce(p_data->'fixtures','[]'::jsonb)) = 0
       and jsonb_array_length(coalesce(p_data->'results','[]'::jsonb)) = 0 then
      raise exception 'refusing to overwrite populated category with an empty competition payload; local changes remain queued and existing cloud data is preserved'
        using errcode = '22023';
    end if;
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

revoke all on function public.save_category_data(uuid,text,text,integer,jsonb,bigint) from public, anon;
grant execute on function public.save_category_data(uuid,text,text,integer,jsonb,bigint) to authenticated;

commit;
