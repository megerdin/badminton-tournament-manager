# Badminton Tournament Manager — Category-scoped persistence prototype

**Status: staging prototype only. Do not deploy to production.**

This package advances the redesign from a schema proposal to a local implementation branch. It is not a production-ready release because the SQL has not been executed on PostgreSQL staging, browser/mobile tests have not been run, and no real Supabase account has been used for integration tests.

## Contents

- `candidate-app/` — V5.3.79 test branch. Category-scoped persistence is **disabled by default** (`categoryScopedPersistence: false`). Existing persistence remains active unless deliberately enabled after staging setup.
- `reference-app/` — untouched V5.3.78 source reference used for the branch.
- `supabase/001_category_scoped_persistence.sql` — additive staging migration: adds `clubs.shared_data`, creates isolated category rows, RLS, an atomic revision-checked category-save RPC, a metadata-save RPC that cannot falsely set the migration marker, and a transactional full-master replacement RPC.
- `supabase/002_rollback_staging_only.sql` — destructive rollback draft for staging only. It drops the new table/functions but leaves `clubs.shared_data` by default.
- `supabase/003_staging_validation.sql` — read-only checks for category IDs, exact JSONB payload parity, team/player/group/fixture/result counts and the migration marker.
- `js/categoryPersistenceAdapter.js` — adapter between the new rows and the existing master JSON contract; includes a guarded legacy migration helper.
- `js/categorySyncQueue.js` — durable per-category, club-metadata and whole-master operation queue.
- `tests/` — mocked behaviour tests and static SQL/integration guard checks.

## Data model

- `clubs`: shared club name and `shared_data` (currently shared tournament date and a migration marker).
- `categories`: one row per category. The existing application category ID is preserved as `legacy_category_id` text; each row stores the full existing category tournament object in `data jsonb`.
- `tournaments`: retained untouched as the legacy source and rollback aid. Routine category-mode saves write only the active category row plus shared club metadata. They do not replace the whole legacy tournament row.

This is intentionally a hybrid model: relational rows define ownership and save boundaries, while each category's complex tournament object stays JSONB to minimise changes to tournament calculations and export/import.

## Key safeguards

1. Ordinary save queues only the active category and shared club metadata.
2. The category save RPC serializes writes for the owning club (so full imports cannot race category saves) and checks the expected revision. The client automatically retries local category data against a newer revision, per the current single-user policy.
3. Explicit JSON import, category-list create/remove/rename, and Reset All use a transactional whole-master replacement. That operation intentionally deletes omitted categories.
4. A migration marker (`shared_data.categoryPersistenceVersion = 1`) is set only by the complete replacement RPC. If category rows exist without the marker, startup refuses to load them as a complete set.
5. Offline operations remain in a localStorage queue; each category is coalesced independently. If the cloud account/club has not yet been resolved, a bootstrap snapshot is kept and compared with the last confirmed cloud baseline after reconnection. Only categories that actually changed locally are queued. With no trustworthy baseline, cloud wins unless the operation was an explicit full import. Failed writes are not removed from the queue.
6. `tournaments` is not dropped, truncated or changed by the draft migration.

## Staging-only validation sequence

1. Create a separate Supabase staging project or isolated database branch. Do not use production.
2. Restore a copy of the current schema/policies and a representative JSON export with two populated categories.
3. Run `supabase/001_category_scoped_persistence.sql` in staging only. Verify that the functions compile and the RLS policies behave as expected.
4. In `candidate-app/js/storage.js`, change `categoryScopedPersistence: false` to `true` **only for the staging build**.
5. Sign in with an approved owner account. On first category-mode startup, if `categories` is empty, the app seeds it from the existing `tournaments.data` master snapshot (or local master only when the legacy cloud snapshot is empty). Verify both category row counts and payloads before testing saves.
6. Test A&B save, C&D save, reload on a second browser, category create/rename/remove, current-category reset, Reset All, JSON export/import, offline save/retry, and revision-race behaviour.
7. Test unauthorised users, non-owner users, invalid category IDs and malformed imports.
8. Do not cut over production until database-level tests and real browser/mobile integration tests pass and a rollback has been rehearsed.

## Rollback note

After category-mode saves begin, the old `tournaments.data` snapshot will be stale because ordinary saves intentionally no longer write to it. To roll back safely, export the complete master JSON while category mode is enabled, disable category mode in the test build, then import that JSON through the legacy application and wait for a confirmed cloud sync. Verify both categories in a fresh session before reverting any schema. Never simply disable the feature flag after new category data has been saved.

## Current test evidence

- Adapter mock tests cover category isolation, full-master assembly, automatic revision retry, independent club metadata, invalid import rejection, migration skip safety, and initial migration of all categories.
- Queue mock tests cover per-category coalescing, separate club metadata, in-flight saves, offline retry, and whole-master import superseding earlier pending operations.
- Static SQL checks verify additive migration intent, owner/approval checks, RLS, revision locking, and restricted RPC execution.
- App integration guard checks verify feature flag default-off, script order, startup approval guard, and full-master operations for imports/resets/category-list changes.
- All application JavaScript files pass `node --check`; package integrity is checked after packaging. A final design audit added a server-side metadata RPC because ordinary metadata saves must not create a false migration-complete marker.

**Not yet proven:** SQL execution on PostgreSQL, real RLS enforcement, live Supabase integration, browser/mobile UX, and end-to-end import/export under the new schema.
