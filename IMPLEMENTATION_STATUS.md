# Implementation status — Category persistence redesign

## Completed in this prototype branch
- [x] Audit current whole-master JSON persistence and category data boundary.
- [x] Additive SQL draft for `categories`, `clubs.shared_data`, RLS and secured RPCs, including a metadata RPC that preserves the migration marker rather than creating it.
- [x] Adapter to load category rows into the existing master JSON contract.
- [x] Atomic category save with revision-aware automatic retry.
- [x] Transactional full-master replacement for imports, category-set edits and Reset All.
- [x] Local durable operation queue keyed by club/category; club metadata is separate.
- [x] Offline bootstrap snapshot and last-confirmed baseline comparison for recovery before the cloud club is resolved.
- [x] Legacy seeding path when the category table is empty.
- [x] Migration marker and startup guard against loading an unmarked/possibly partial category set.
- [x] Candidate app branch wired behind a feature flag that defaults to disabled.
- [x] Regression tests for adapter, queue, static SQL safeguards and application call paths.

## Must be completed before production
- [ ] Execute the SQL on PostgreSQL/Supabase staging and fix any SQL/runtime errors.
- [ ] Verify RLS with owner, unapproved user, non-owner and master-admin test accounts.
- [ ] Run the candidate against a staging Supabase project.
- [ ] Verify both populated categories migrate exactly, including settings, pools, fixtures, results, rankings and match overrides.
- [ ] Test normal browser, Android/iOS, incognito, two-device category saves, offline queue and import/reset.
- [ ] Verify rollback by exporting category-mode master, restoring the legacy `tournaments.data` row through import, and loading it in a clean session.
- [ ] Obtain explicit approval before production schema migration or deployment.

Final audit finding: routine metadata updates previously could set the category migration marker before a complete category replacement. This was corrected in the draft SQL and adapter; tests cover preserving an existing marker and preventing a false marker. SQL still requires execution against PostgreSQL before any production use. No live Supabase schema or data has been changed.
