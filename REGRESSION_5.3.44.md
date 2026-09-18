# Badminton Tournament Manager — v5.3.44 Regression

## Purpose
Cloud/offline persistence hardening following v5.3.43.

## Defect found
The v5.3.43 cloud queue used `queuedAt` (millisecond timestamp) as the identity of the uploaded snapshot. Two saves occurring within the same millisecond could theoretically receive the same timestamp, allowing the newer queued snapshot to be mistaken for the snapshot already uploaded.

## Fix
The cloud queue now assigns each queued snapshot a unique `queueId` using `crypto.randomUUID()` with a browser-safe fallback. Upload completion compares `queueId`, not only the timestamp. A newer local change therefore remains queued even if both saves occur in the same millisecond.

## Verification
- All JavaScript files pass `node --check`.
- Concurrent-save simulation: PASS — newer snapshot remained queued and returned `synced-with-pending`.
- Cloud version advanced only for the uploaded snapshot: PASS.
- Queue identity survives queue updates: PASS by code inspection.
- Existing localStorage key retained: PASS.
- Existing cloud queue key retained: PASS.
- Tournament engine unchanged except version constant: PASS.
- Supabase schema unchanged: PASS.
- Supabase live project remains healthy and existing RLS policies remain in place.
- Browser runtime smoke test remains unavailable in this execution environment because Chromium hangs before producing DOM output; this is not counted as a runtime pass.

## Security note
The live `admin_set_approval(uuid,text)` function remains a `SECURITY DEFINER` RPC callable by `authenticated`, but its function body requires `private.is_master_admin()` before any update. Supabase Advisor therefore continues to report the documented warning. This is intentional for the current browser-based master-admin workflow and was not weakened merely to remove the warning.


## Superseded security note
The security warning described here was subsequently resolved in v5.3.46 by converting the approval RPC to SECURITY INVOKER and enforcing master-admin access through RLS.
