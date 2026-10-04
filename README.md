# Badminton Tournament Manager — Production

**Production version: V5.3.79.** The GitHub Pages root app and candidate source are aligned, and category-scoped persistence is enabled against the existing main Supabase project.

The additive category-persistence schema was applied to the main Supabase project on 2026-10-04. Existing user accounts and legacy tournament records are retained. The categories table starts empty and each club is migrated on its first approved, authenticated startup: the app reads that club's legacy tournament snapshot, validates/converts it through the application migration path, writes the complete category set transactionally, then confirms the migration marker. Routine saves thereafter update the active category and shared club metadata; full imports and category-list changes use the full-master replacement RPC.

GitHub Actions automated tests and Pages deployment passed for the pre-promotion commit. A new run will validate this production promotion. Database transaction checks previously verified revision conflicts, owner authorization, migration-marker handling and denial of unauthenticated/non-owner calls. The available connected tools do not provide a real authenticated browser/mobile session, so real-device sign-in, cross-device reload, offline recovery and export/import UX still require live smoke testing.

## Contents

- index.html, css/ and js/ — production app deployed at the GitHub Pages root, V5.3.79.
- candidate-app/ — source mirror for the production app and its category-persistence modules.
- reference-app/ — untouched V5.3.78 reference.
- supabase/001_category_scoped_persistence.sql — reviewed additive schema reference; the corresponding migration is already applied to main. Do not rerun it blindly.
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

The live migration is recorded as 20261004153301 / category_scoped_persistence_main_additive. The checked-in SQL is a reference for review, not an instruction to apply it again to the existing project.
