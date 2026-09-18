# Major Step 7 — Production Sync, Offline and Conflict Handling

Version: v5.3.33

Completed the production sync layer without changing tournament rules or UI behaviour.

## Included
- LocalStorage remains the immediate local save boundary.
- Supabase cloud save remains version-checked.
- Offline changes stay queued locally.
- Queue is isolated by authenticated user and tournament.
- Failed cloud writes retain the latest snapshot and error metadata.
- Automatic retry uses bounded exponential backoff.
- Retry is triggered by reconnect, window focus, and visibility return.
- A detected cloud version conflict is latched rather than silently overwritten.
- Successful sync clears the queue and resets retry state.

## Validation
- All JavaScript files pass `node --check`.
- HTML references exactly the intended six scripts.
- No service-role/secret key is introduced.
- v5.3.32 remains the previous checkpoint.
