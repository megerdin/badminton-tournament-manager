# Badminton Tournament Manager — Category-scoped persistence prototype

**Status: guarded candidate; category persistence remains disabled. Do not enable for production yet.**

The additive category-persistence schema has been applied to the existing main Supabase project on 2026-10-04 and database-level checks have passed, including revision conflicts, owner authorization, and rollback-isolated write tests. Existing users and legacy tournament records were preserved. The new `categories` table is still empty and the app feature flag remains `false`. GitHub Actions passes the current automated suite. Real browser/mobile end-to-end testing with an authenticated Supabase session is still outstanding.

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
5. During first-time bootstrap, local data may seed category storage only when the legacy cloud snapshot is genuinely empty. A non-empty but unrecognized legacy snapshot stops migration with an explicit error instead of risking a stale-local overwrite.
6. Failed writes are not removed from the queue.
6. `tournaments` is not dropped, truncated or changed by the draft migration.

## Remaining validation sequence

1. Do not re-run `001_category_scoped_persistence.sql` against the main project. The live migration is already recorded as `20261004153301 / category_scoped_persistence_main_additive`. The checked-in SQL is a review/deployment reference; compare it with the live definitions before using it elsewhere.
2. For safer end-to-end testing, create a separate Supabase staging project and apply a reviewed copy of the migration there. Do not use the main project for destructive rollback rehearsal.
3. Keep `categoryScopedPersistence: false` in `candidate-app/js/storage.js` until authenticated browser/mobile integration tests pass.
4. On first category-mode startup, if `categories` is empty, the app is intended to seed it from the legacy `tournaments.data` master snapshot (or local master only when the legacy cloud snapshot is empty). Verify category IDs and JSON payload parity before testing saves.
5. Test each category save and reload on a second browser, category create/rename/remove, current-category reset, Reset All, JSON export/import, offline save/retry, and revision-race behaviour.
6. Test unauthorised users, non-owner users, invalid category IDs and malformed imports.
7. Do not enable the feature on the live app until the end-to-end tests pass and a rollback has been rehearsed.

## Rollback note

After category-mode saves begin, the old `tournaments.data` snapshot will be stale because ordinary saves intentionally no longer write to it. To roll back safely, export the complete master JSON while category mode is enabled, disable category mode in the test build, then import that JSON through the legacy application and wait for a confirmed cloud sync. Verify both categories in a fresh session before reverting any schema. Never simply disable the feature flag after new category data has been saved.

## Current test evidence

- Adapter mock tests cover category isolation, full-master assembly, automatic revision retry, independent club metadata, invalid import rejection, migration skip safety, and initial migration of all categories.
- Queue mock tests cover per-category coalescing, separate club metadata, in-flight saves, offline retry, and whole-master import superseding earlier pending operations.
- Static SQL checks verify additive migration intent, owner/approval checks, RLS, revision locking, and restricted RPC execution.
- App integration guard checks verify feature flag default-off, script order, startup approval guard, and full-master operations for imports/resets/category-list changes.
- All application JavaScript files pass `node --check`; package integrity is checked after packaging. A final design audit added a server-side metadata RPC because ordinary metadata saves must not create a false migration-complete marker. A follow-up bootstrap audit also added a fail-safe for non-empty, unrecognized legacy cloud snapshots so stale browser data cannot silently become the initial migration source.

**Verified on the main database:** migration is recorded; required tables/columns/RPCs and grants exist; test transactions exercised save/revision conflict, full-master replacement, metadata marker preservation, non-owner denial and unauthenticated execute denial, with test writes rolled back. Existing data counts remained unchanged and the new categories table remained empty.

**Not yet proven:** authenticated REST/browser integration, real browser/mobile UX, cross-device reload, and end-to-end import/export with category mode enabled. SQL-level checks do not replace those tests.
