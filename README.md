# Badminton Tournament Manager — Production

**Production version: V5.3.81.** The GitHub Pages root app is the single production application, and category-scoped persistence is enabled against the existing main Supabase project.

The additive category-persistence schema and the production legacy-category backfill were applied to the main Supabase project on 2026-10-04. Existing user accounts and legacy tournament records are retained. The backfill migrated only clubs with no category rows and a fully valid `badmintonTournamentManagerMaster` snapshot; existing live category sets were skipped. Two empty or unrecognized legacy records remain intentionally untouched and are handled by the guarded application startup path rather than overwritten. Routine saves update category-scoped records and shared club metadata. Category renames now use the scoped save path rather than a full-master replacement. The database also rejects stale full-master snapshots that would empty a populated category; only explicit JSON import and Reset All operations may intentionally clear category data. V5.3.81 adds server-side protection against stale full-master overwrites and routes category renames through scoped persistence. It also fixes a debounced-autosave confirmation defect: rapid edits now resolve all waiting save callers with the eventual cloud result instead of leaving an earlier manual-save confirmation unresolved.

GitHub Actions automated tests and the GitHub Pages deployment both completed successfully for the production promotion. Future pushes to main continue to run the automated suite and publish the root app. Database transaction checks previously verified revision conflicts, owner authorization, migration-marker handling and denial of unauthenticated/non-owner calls. The available connected tools do not provide a real authenticated browser/mobile session, so real-device sign-in, cross-device reload, offline recovery and export/import UX still require live smoke testing.

## Contents

- index.html, css/ and js/ — production app deployed at the GitHub Pages root, V5.3.81.
- supabase.md — canonical production Supabase connection, security, schema, migration and verification guide.
- supabase/001_category_scoped_persistence.sql — reviewed additive schema reference; already applied to main. Do not rerun it blindly.
- supabase/005_backfill_valid_legacy_category_snapshots.sql — guarded, additive backfill applied to main; skips clubs with existing category rows and leaves legacy snapshots intact.
- supabase/002_rollback_staging_only.sql — destructive rollback draft for isolated testing only. Never run against main.
- supabase/003_staging_validation.sql — read-only validation queries for a selected club.
- tests/ — adapter/queue mock tests, static SQL safety checks, app integration guards and HTML safety checks.

## Data model

- clubs: shared club name and shared_data, including the shared tournament date and migration marker.
- categories: one row per category, preserving the application category ID as legacy_category_id and storing the complete category object in data jsonb.
- tournaments: retained as the legacy snapshot and compatibility/rollback source. Routine category-mode saves do not update this legacy snapshot after migration.

This hybrid model keeps category save boundaries isolated while preserving the existing tournament JSON contract and calculations.

## Production safeguards

1. Ordinary saves queue the active category and shared club metadata; they do not replace other categories.
2. The category-save RPC serializes writes for a club and checks the expected revision. Revision conflicts are handled by the client queue.
3. Explicit JSON imports, category-list changes and Reset All use a transactional full-master replacement. Omitted categories are intentionally removed only by that explicit operation.
4. The migration marker is set only by a complete full-master replacement. If category rows exist without the marker, startup refuses to load a potentially incomplete category set.
5. Offline operations remain in a durable localStorage queue. Once connectivity returns, bootstrap changes are compared with the last confirmed cloud baseline; without a trustworthy baseline, cloud wins unless the user explicitly imported/replaced the full master.
6. Local browser data is permitted to seed categories only when the legacy cloud snapshot is genuinely empty. An unrecognized non-empty cloud snapshot stops migration without overwriting it.
7. Existing tournament records, user profiles and auth users are retained. Do not drop or truncate them.

## First login after deployment

1. Sign in using an approved account.
2. The app loads that club's legacy snapshot. If the category table is empty, it converts the supported snapshot and performs a complete transactional category write.
3. The app reloads the saved category set and verifies the migration marker before normal category-mode operation.
4. If migration fails, the app should show a sync/startup error and preserve the legacy cloud snapshot. Do not reset the account or manually delete data to work around a migration error.
5. Verify each category, team/player pool, groups, fixtures, results and settings; save one harmless change and reload from a second session before relying on the new storage path.

## Validation and rollback

- CI is the automated test runner; no local Node.js installation is required.
- The live main database has been checked for the additive schema, RLS, RPC grants, revision conflicts, owner authorization and marker preservation.
- Authenticated browser/mobile end-to-end tests are not represented by mocked tests or SQL transaction checks. Perform live smoke checks after deployment.
- Once category-mode writes have occurred, the legacy tournaments.data snapshot can be stale. A rollback must first export the complete master from category mode, disable category mode in the app, import that JSON through the legacy app, wait for confirmed cloud sync, and verify in a fresh session. Never simply flip the flag off after category writes.

## Main Supabase migration record

The live migrations are recorded as 20261004153301 / category_scoped_persistence_main_additive, 20261004162444 / categories_updated_by_index, and 20261004165646 / backfill_valid_legacy_category_snapshots. The checked-in SQL files document the applied changes; do not rerun them blindly.
