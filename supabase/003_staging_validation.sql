-- READ-ONLY STAGING VALIDATION QUERIES.
-- Replace the UUID below with the club ID in the isolated staging project.
-- These statements do not write or alter data.

-- 1) Compare the legacy master category IDs with the category table and verify
-- that each JSONB category payload is exactly equal to the legacy category data.
with legacy as (
  select t.club_id, c.value->>'id' as legacy_category_id,
         c.value->'data' as data
  from public.tournaments t
  cross join lateral jsonb_array_elements(t.data->'categories') c(value)
  where t.club_id = '00000000-0000-0000-0000-000000000000'::uuid
), current_categories as (
  select club_id, legacy_category_id, data, revision
  from public.categories
  where club_id = '00000000-0000-0000-0000-000000000000'::uuid
)
select coalesce(l.legacy_category_id, n.legacy_category_id) as category_id,
       (l.legacy_category_id is not null) as exists_in_legacy,
       (n.legacy_category_id is not null) as exists_in_new_table,
       (l.data = n.data) as payload_jsonb_equal,
       jsonb_array_length(coalesce(l.data->'teams','[]'::jsonb)) as legacy_teams,
       jsonb_array_length(coalesce(n.data->'teams','[]'::jsonb)) as new_teams,
       jsonb_array_length(coalesce(l.data->'players','[]'::jsonb)) as legacy_players,
       jsonb_array_length(coalesce(n.data->'players','[]'::jsonb)) as new_players,
       jsonb_array_length(coalesce(l.data->'groups','[]'::jsonb)) as legacy_groups,
       jsonb_array_length(coalesce(n.data->'groups','[]'::jsonb)) as new_groups,
       jsonb_array_length(coalesce(l.data->'fixtures','[]'::jsonb)) as legacy_fixtures,
       jsonb_array_length(coalesce(n.data->'fixtures','[]'::jsonb)) as new_fixtures,
       jsonb_array_length(coalesce(l.data->'results','[]'::jsonb)) as legacy_results,
       jsonb_array_length(coalesce(n.data->'results','[]'::jsonb)) as new_results,
       n.revision as category_revision
from legacy l
full outer join current_categories n using (club_id, legacy_category_id)
order by category_id;

-- 2) Count categories on each side. Counts must match after a complete migration.
select
  (select count(*) from public.tournaments t
   cross join lateral jsonb_array_elements(t.data->'categories') cat(value)
   where t.club_id = '00000000-0000-0000-0000-000000000000'::uuid) as legacy_category_count,
  (select count(*) from public.categories c
   where c.club_id = '00000000-0000-0000-0000-000000000000'::uuid) as new_category_count
from public.tournaments t
where t.club_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- 3) Confirm the migration marker and shared club fields.
select id, name, shared_data->>'categoryPersistenceVersion' as category_persistence_version,
       shared_data->>'date' as shared_tournament_date
from public.clubs
where id = '00000000-0000-0000-0000-000000000000'::uuid;
