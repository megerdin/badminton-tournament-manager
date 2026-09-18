# Badminton Tournament Manager — Regression Report V5.3.58

## Scope
Final deep regression pass covering the requested authentication/UI changes, administrator approval flow, PDF output, profile placement, inactivity timeout, cloud/RLS access, and version consistency.

## Findings and fixes
- Login subtitle now reads `Sign in to use the cloud version V5.3.58.`
- Sign-in/sign-up mode switch is implemented as a clear Sign up link and tested.
- Pending approval message changed to `Awaiting for Admin approval.`
- No `Master admin` / `master-admin` wording remains in the GUI.
- User Profile role displays `Admin` rather than the internal `master_admin` value.
- Administrator approval list is rendered as soon as an approved administrator profile is loaded, before tournament loading can block the admin workflow.
- Approval action now reports failures visibly and verifies the server-side approval state before refreshing the list.
- Root cause of the live administrator approval failure was found and fixed in Supabase: authenticated clients had EXECUTE grants on protected `private.*` helper functions but lacked USAGE on the `private` schema. `GRANT USAGE ON SCHEMA private TO authenticated` was applied and recorded in `supabase/policies.sql`.
- Live RLS simulation as the administrator now successfully lists protected records and executes `public.admin_set_approval(...)`; the approval test was rolled back, leaving the test user pending.
- Pending test account verified in live DB: Amin / Magpie / London / megerdin@hotmail.com, status pending.
- A pending non-admin simulation can see its own profile but no clubs/tournaments/members through RLS.
- PDF club title remains 18pt and group fixture title 16pt after the requested swap.
- `Blank cells are provided for fixture entries.` is absent from the PDF generation path.
- User Profile remains at the bottom of the main content, after About & License.
- 30-minute inactivity timeout remains enabled and uses local-session sign-out.
- Version flag is consistent: exactly one `#appVersion`, `V5.3.58`, matching `APP_VERSION = '5.3.58'` and the login subtitle.

## Automated checks
- `node --check` passed for all JavaScript modules.
- HTML IDs: 136 total / 136 unique / 0 duplicates.
- Auth mode switching test passed.
- Admin pending-user rendering and approval/verification test passed with a deterministic client harness.
- Signup metadata payload test passed.
- Profile fallback test passed.
- Supabase authenticated-role RLS/admin approval test passed after schema USAGE fix.
- Supabase security advisor checked after the fix.
- ZIP integrity checked after packaging.

## Supabase advisor status
Security advisor remaining warning: leaked password protection is disabled.
Performance advisor retains existing notices for RLS init plans, two unindexed foreign keys, an unused index, and multiple permissive policies. These were not changed because they are performance/maintenance findings rather than blockers for the requested authentication workflow.

## Live data safety
The pending test account was not approved permanently during regression. The live approval test was performed inside a transaction and rolled back. No tournament data was modified by the regression test.
