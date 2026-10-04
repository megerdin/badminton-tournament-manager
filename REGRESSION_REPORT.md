# Regression report — category persistence prototype v2

## Summary

The category-scoped persistence prototype is implemented in the V5.3.79 candidate branch, with the feature flag disabled by default. It preserves the V5.3.78 source under `reference-app/` and does not change the live Supabase project.

## Verified by automated local tests

- Category adapter loads all category rows and assembles the current master JSON shape.
- Saving A&B leaves C&D's row, data and revision unchanged.
- Revision mismatch is resolved automatically by retrying the intended local category payload against the latest revision.
- Club metadata is persisted separately from tournament category data.
- Invalid full-master import is rejected before any RPC call.
- Explicit full-master replacement updates the intended category set and is the only operation that removes omitted categories.
- Legacy migration skips existing category rows by default and seeds all categories when the target table is empty.
- Offline baseline diff isolates actual local category edits and avoids treating shared club-name/date drift as tournament changes.
- Queue coalesces repeated saves for the same category while preserving other category operations and club metadata.
- A new save made while an earlier write is in flight remains queued and is rebased on the confirmed revision.
- Failed writes retain the queue and can be retried.
- Explicit full import supersedes earlier pending operations and refreshes category revisions.
- SQL static checks confirm additive migration intent, owner/approval checks, RLS, restricted RPC execution and shared club-level transaction locks.
- App integration checks confirm the new adapter loads before storage, the feature flag is off by default, startup approval checks remain in place, and import/reset/category-list operations use full-master replacement.
- JavaScript syntax checks pass; candidate HTML has 132 IDs with no duplicates.

See `TEST_RESULTS.txt` for the captured test output.

## Important limitations

- SQL has **not** been executed on PostgreSQL or Supabase staging. SQL static checks cannot prove compilation or runtime behaviour.
- RLS has not been tested using real owner, unapproved, non-owner or master-admin accounts.
- No real browser/mobile or live Supabase end-to-end test has been performed.
- The feature flag is intentionally `false`; do not enable it against production.
- Existing `public.tournaments` data is not modified by the draft migration. After category-mode saves begin in staging, the legacy snapshot becomes stale; follow the documented export/import rollback procedure rather than merely disabling the flag.

## Gate before production

Apply the additive SQL only to an isolated staging project, enable the feature flag only in that staging build, run `003_staging_validation.sql`, then complete the browser/mobile and permission regression matrix in `README.md`. Do not migrate or deploy production until all gates pass and explicit approval is given.


## Final design audit correction

A final review found that the ordinary club metadata adapter could set `categoryPersistenceVersion=1`, despite the documented rule that only complete master replacement may set it. Added `save_club_metadata` as a server-side RPC using the same per-club advisory lock. It preserves an existing marker and strips any caller-supplied marker when none exists. The adapter now uses that RPC. Mock tests cover both existing-marker preservation and prevention of a false marker. This remains static/mock validation; the SQL has not been executed on PostgreSQL.
