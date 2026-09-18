# Badminton Tournament Manager — v5.3.47 Regression

## Scope
Cloud/offline persistence hardening following v5.3.46.

## Fixes
1. Prevented startup from loading the remote tournament over a still-pending local snapshot after an offline or transient cloud failure.
2. Added a defensive guard inside `loadRemoteIntoApp()` so a queued local snapshot is never silently cleared or replaced by remote data.
3. Preserved the v5.3.45 sequential-save queue rebase fix.
4. Updated the displayed application version to v5.3.47.

## Expected behaviour
- Offline/local changes remain in localStorage and the cloud queue.
- A transient upload failure leaves the queue intact and retries later.
- On reconnect, queued local data is uploaded before remote data is loaded.
- A genuine remote version change remains a conflict and does not auto-overwrite either side.
- Existing tournament engine functionality is unchanged.

## Verification
- All JS files pass `node --check`.
- Package structure verified after ZIP creation.
- Supabase security advisor was rechecked: the previous exposed SECURITY DEFINER warning is resolved. The only remaining advisor warning is the optional leaked-password-protection setting.
- Browser runtime smoke testing remains unavailable in this environment because the headless browser test previously hung; no browser-runtime PASS is claimed.
