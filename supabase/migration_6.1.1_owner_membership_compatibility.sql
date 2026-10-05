-- V6.1.1 compatibility repair for Clubs created by older V6 test builds.
-- Safe to run once: restores owner membership rows from clubs.owner_id.
insert into public.club_members(club_id,user_id,role)
select c.id,c.owner_id,'owner'
from public.clubs c
where c.owner_id is not null
on conflict (club_id,user_id) do update set role='owner';
