# Regression Report — V5.3.76 (logical audit update)

## Purpose
Replace user-mediated conflict resolution and category-level three-way merging with automatic single-user synchronisation. No Supabase schema, SQL, or live data were changed.

## Automatic policy
- With no pending local queue, the latest cloud snapshot is loaded on startup.
- When the cloud version has advanced and the queued local snapshot is identical to its known baseline, the stale copy is cleared and the latest cloud snapshot is loaded.
- When a queued local snapshot contains pending changes and has a trustworthy baseline, it automatically takes precedence under the single-user save policy. The app attempts a conditional versioned write; if another write races it, the queue remains and retries.
- Queues created before successful cloud hydration, and legacy queues without a baseline, are treated as ambiguous/stale and replaced by cloud data rather than being allowed to overwrite cloud blindly.
- Offline or failed writes retain the local queue and retry. The queue is cleared only after a confirmed successful write or when the stale/ambiguous local copy is replaced by cloud data.
- Removed manual “Keep local” / “Use cloud” controls and the category three-way merge.

## Static validation
- Passed `node --check` for all JavaScript modules.
- Passed HTML duplicate-ID check: 132 IDs, no duplicates.
- Passed ZIP integrity check.

## Logical audit finding
Initial review found a data-loss risk: a queue created before cloud hydration had `baseSnapshot=null`, and the old branch treated that absence as evidence of local changes. It could therefore overwrite the cloud with an unverified local snapshot. The decision now explicitly treats `requiresReview` or missing baseline as ambiguous and lets the cloud win automatically.

## Remaining validation
The code-path decision was reviewed statically. Full browser/mobile testing and real two-device Supabase testing have not been performed. This is a single-user policy: simultaneous independent edits are not merged, and a pending local snapshot may replace another session's cloud snapshot.
