# Supabase Production Guide

## Production connection

- **Project:** Badminton
- **Project ID:** `tumqpsbwelmwawbkqtjh`
- **Region:** `eu-west-2`
- **Project URL:** `https://tumqpsbwelmwawbkqtjh.supabase.co`
- **Application:** [Badminton Tournament Manager](https://megerdin.github.io/badminton-tournament-manager/)
- **Production branch:** GitHub `main` only

The browser app connects directly to Supabase Auth and Postgres through the Supabase JavaScript v2 client. Supabase is the authoritative online copy. Browser localStorage is the immediate local save/cache and durable retry queue used during network interruptions; a queued save is not considered synced until Supabase confirms it.

## Browser connection configuration

The production configuration is in `js/storage.js` as `window.BADMINTON_CLOUD_CONFIG`. The same module is mirrored at `candidate-app/js/storage.js`; keep the copies aligned when changing the connection.

The browser needs only:
- The project URL above.
- The project's **publishable** key, copied from Supabase Dashboard → Project Settings → API Keys.

A Supabase publishable key is designed to be visible in browser code. It is not a database password. **Never commit a `service_role` or secret API key, database password, SMTP password, or email-provider app password.** Public-key safety depends on the database RLS policies and authorization checks on RPCs; do not disable those controls to make a request work.

The root `index.html` loads the Supabase JavaScript v2 client, then `js/tournament.js`, `js/ui.js`, `js/categoryPersistenceAdapter.js`, `js/categorySyncQueue.js`, `js/storage.js`, `js/auth.js`, and `js/app.js`. Keep this dependency order intact.

## Production data model

- `auth.users`: Supabase identities.
- `profiles`: approval status and application role.
- `clubs`: owner, club name and shared metadata in `shared_data`.
- `tournaments`: retained legacy snapshot and compatibility/recovery reference. Routine category-mode saves do not keep this snapshot current.
- `categories`: one row per tournament category, keyed by `club_id` and the stable application category ID in `legacy_category_id`. Category data and a monotonically increasing revision are stored in `data` and `revision`.
- `tournament_members`: tournament membership and role records.

Category-mode writes use these guarded RPCs:
- `save_category_data(...)` — saves one category with an expected revision.
- `save_club_metadata(...)` — saves shared metadata without changing the migration-complete marker.
- `replace_club_master(...)` — transactionally replaces the complete category set for explicit full imports, category-list changes and reset-all operations.

The category table has RLS enabled. RPCs check that the caller is authenticated, approved and either the club owner or master admin. Do not bypass these checks.

## Applied production migrations

The following migrations are recorded in the existing production project:

| Version | Migration |
| --- | --- |
| `20261004153301` | `category_scoped_persistence_main_additive` |
| `20261004162444` | `categories_updated_by_index` |
| `20261004165646` | `backfill_valid_legacy_category_snapshots` |

Checked-in SQL references:
- `supabase/001_category_scoped_persistence.sql`
- `supabase/004_categories_updated_by_index.sql`
- `supabase/005_backfill_valid_legacy_category_snapshots.sql`

These files document migrations already applied to production. **Do not rerun them blindly.** The backfill only populated clubs with no category rows and a fully valid `badmintonTournamentManagerMaster` snapshot. It skipped existing category sets and retained all legacy tournament records. Empty or unrecognized legacy snapshots are intentionally left untouched for the guarded application startup path.

## User and data safeguards

1. Approved users sign in through Supabase Auth; pending accounts must not be allowed to write tournament data.
2. Ordinary saves queue the active category plus shared club metadata. Other category rows are retained.
3. Offline saves stay in a per-user/per-club localStorage queue and retry on network recovery, tab focus and visibility recovery. Check the visible cloud status before assuming a save reached the server.
4. Full imports and category-list replacement are explicit whole-master operations. They can replace the complete category set; never use them as a routine save.
5. Keep `tournaments.data`, `profiles`, `auth.users`, `clubs` and existing category data unless a reviewed migration explicitly requires a change. Never solve a sync problem by deleting user or tournament rows.
6. Export a JSON backup before major import/reset work. After category-mode writes, the legacy `tournaments.data` snapshot can be stale; do not roll back by merely disabling the category-persistence flag.

## Production verification

Read-only checks for migration inventory and table counts can be run through the connected Supabase tools or SQL Editor. For a particular club, compare:
- Its `clubs.shared_data->>'categoryPersistenceVersion'` marker.
- Its category row count in `categories`.
- The category names, team/player counts and revision values.
- The visible app status after a save, followed by a reload in a fresh session.

Automated tests and SQL transaction checks do not replace a real authenticated browser/mobile smoke test. Verify login, category switching, a harmless edit, a cloud-confirmed save, fresh-session reload, offline queue recovery, and JSON export/import in the live app. Do not claim these browser tests passed unless they were actually performed.

## Auth and security settings

- Keep signup approval gating enabled.
- Configure the allowed redirect URL for the production GitHub Pages URL in Supabase Auth.
- Enable leaked-password protection in Supabase Auth password security settings.
- Review Supabase Security Advisor warnings after changes to RLS or security-definer functions.
- Keep database secrets and email-provider credentials in Supabase/provider secret settings, not in GitHub files.
