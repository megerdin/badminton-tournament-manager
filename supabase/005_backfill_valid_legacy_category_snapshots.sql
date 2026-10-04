-- Backfill valid legacy master snapshots into category-scoped storage.
-- Production-only additive migration. Existing category rows and every legacy
-- tournament snapshot are preserved. Only clubs with an empty category table
-- and a fully valid badmintonTournamentManagerMaster snapshot are eligible.
begin;

with eligible as materialized (
  select c.id as club_id, t.data as snapshot
  from public.clubs c
  join public.tournaments t on t.club_id = c.id
  where t.data->>'type' = 'badmintonTournamentManagerMaster'
    and jsonb_typeof(t.data->'categories') = 'array'
    and jsonb_array_length(t.data->'categories') > 0
    and not exists (
      select 1 from public.categories existing where existing.club_id = c.id
    )
    and not exists (
      select 1
      from jsonb_array_elements(t.data->'categories') as item(category)
      where nullif(trim(coalesce(item.category->>'id', '')), '') is null
         or coalesce(jsonb_typeof(item.category->'data'), 'null') <> 'object'
    )
    and (
      select count(distinct item.category->>'id')
      from jsonb_array_elements(t.data->'categories') as item(category)
    ) = jsonb_array_length(t.data->'categories')
)
insert into public.categories (
  club_id, legacy_category_id, name, sort_order, data, revision
)
select
  eligible.club_id,
  item.category->>'id',
  coalesce(nullif(trim(item.category->>'name'), ''), 'Category ' || item.ordinality),
  (item.ordinality - 1)::integer,
  item.category->'data',
  1
from eligible
cross join lateral jsonb_array_elements(eligible.snapshot->'categories')
  with ordinality as item(category, ordinality)
on conflict (club_id, legacy_category_id) do nothing;

-- Mark only fully backfilled clubs as migrated. The existing live club's
-- marker and metadata are not changed by this backfill.
update public.clubs c
set
  name = coalesce(nullif(trim(t.data->>'clubName'), ''), c.name),
  shared_data = coalesce(c.shared_data, '{}'::jsonb)
    || jsonb_build_object(
      'date', coalesce(t.data->>'date', ''),
      'categoryPersistenceVersion', 1
    ),
  updated_at = now()
from public.tournaments t
where t.club_id = c.id
  and t.data->>'type' = 'badmintonTournamentManagerMaster'
  and jsonb_typeof(t.data->'categories') = 'array'
  and jsonb_array_length(t.data->'categories') > 0
  and not (coalesce(c.shared_data, '{}'::jsonb) ? 'categoryPersistenceVersion')
  and (
    select count(*)
    from public.categories live
    where live.club_id = c.id
  ) = jsonb_array_length(t.data->'categories')
  and not exists (
    select 1
    from jsonb_array_elements(t.data->'categories') as item(category)
    where not exists (
      select 1 from public.categories live
      where live.club_id = c.id
        and live.legacy_category_id = item.category->>'id'
    )
  );

commit;
