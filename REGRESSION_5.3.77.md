# Regression Report — V5.3.77

## Scope
Investigated reports that the save message appeared every time but cloud data was not actually confirmed as saved, and whether multi-category saves were discarding inactive categories.

## Findings
- `saveLocal()` serializes `masterTournament` after updating the active category. The master record includes the full `categories` array; `saveActiveCategoryToMaster()` updates only the active category record and leaves inactive category records in place.
- A focused executable regression test using the actual `saveActiveCategoryToMaster()` and `saveLocal()` functions confirmed saving category A preserves category B, and saving category B preserves category A. The complete multi-category master snapshot is passed to the cloud queue on each save.
- The user-facing toast was misleading: it said cloud sync was queued without waiting for the cloud result. This could appear to promise a successful cloud save even when cloud sync remained pending or failed.

## Changes
- Bumped UI/app version to V5.3.77.
- Save feedback now distinguishes local save, cloud syncing, confirmed cloud sync, offline state, stale local data replaced by cloud, and pending/failed cloud sync.
- Failed cloud sync now displays a short error reason in the cloud sync status, while preserving the local queue and retry behaviour.
- Added a matching success-message style for light and dark themes.
- No Supabase schema, SQL, credentials, or live data were changed.

## Validation
- Mocked cloud-sync regression: PASS — normal write uploads the full snapshot and clears the queue only after confirmed success.
- Mocked cloud-wins regression: PASS — an unchanged stale local queue is replaced by newer cloud data.
- Mocked pending-local-change regression: PASS — local changes upload automatically under the last-save-wins policy.
- Mocked write-failure regression: PASS — the queue is retained, retry is scheduled, and the error reason is exposed.
- Focused category persistence regression: PASS — category A update preserved category B.
- Focused category persistence regression: PASS — category B update preserved category A.
- Complete multi-category snapshot passed to cloud queue: PASS.
- Pending cloud sync is no longer reported as successful cloud sync: PASS.
- JavaScript syntax checks: PASS.
- HTML IDs: 132, no duplicates.
- Full browser test and live Supabase write/read test: NOT PERFORMED.

## Conclusion
The inspected category serialization path does not itself discard inactive categories. The misleading toast is fixed, and the cloud status will now expose a concise failure reason so the actual cloud-save problem can be identified rather than mistaken for a successful save. Real cloud persistence still needs to be confirmed in the user's test session.
