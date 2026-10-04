-- Additive production performance index for category audit metadata.
-- Safe to run repeatedly; does not alter or delete tournament/user data.
create index if not exists idx_categories_updated_by on public.categories(updated_by);
