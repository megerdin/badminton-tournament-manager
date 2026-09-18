# Major Step 8 — v5.3.34

## Status
COMPLETE

## Objective
Production-grade Supabase database security and RLS hardening.

## Completed
- Rebuilt the application schema as a complete fresh-project schema.
- Added profiles, clubs, tournaments and tournament_members.
- Added Auth user -> profile trigger.
- Added timestamp triggers.
- Added ownership and membership indexes.
- Added one-club-per-owner and one-primary-tournament-per-club safeguards.
- Added security-definer identity helpers with pinned search_path.
- Added master-admin approval RPC.
- Removed direct browser profile mutation privileges.
- Prevented self-approval and self-role escalation through RLS.
- Restricted tournament reads/writes to approved owners/members.
- Restricted member management to the tournament club owner.
- Kept browser credentials limited to Supabase publishable-key configuration.
- Preserved the existing application and offline architecture.
- No LocalStorage migration is performed.

## Important
Run `schema.sql`, then `policies.sql`, then the one-time `bootstrap_master_admin.sql` for a fresh Supabase project.

The bootstrap script is intentionally a manual SQL-owner operation. It is not exposed through the browser.

## Next major step
Major Step 9 — full static/integration regression audit before connecting a real Supabase project.
