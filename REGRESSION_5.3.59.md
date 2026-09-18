# Regression Report — V5.3.59

## Requested fixes
- Login heading includes current application version.
- Pending message is exactly `Awaiting for Admin approval.`
- No `Master admin` wording is exposed in the GUI; internal database role remains `master_admin`.
- Admin user management now provides Approve, Reject, Suspend and Delete actions as applicable.
- User Profile is physically placed after the main application/bottom controls, at the bottom of the page.
- Existing approved users can create their initial cloud tournament through a guarded RPC.

## Root cause fixed
Approved new users were failing on initial tournament creation because the direct `tournaments` INSERT RLS path did not successfully authorize the parent club relationship in the browser path. The application now creates the initial tournament through `create_initial_tournament`, a guarded SECURITY DEFINER RPC that checks approved status and club ownership.

## Database verification
- Existing pending test account remains pending after all transactional tests.
- `create_initial_tournament` was tested as an approved authenticated user and returned a tournament id/version; transaction was rolled back.
- Unauthorized authenticated execution of `admin_delete_user` returned `not authorized`; transaction was rolled back.
- RPC execute privileges: anon=false, authenticated=true for admin_set_approval, admin_delete_user and create_initial_tournament.
- Unique tournament-per-club index was missing from the live database and was restored as `uq_tournaments_one_primary_per_club`.

## Source verification
- All JS files pass `node --check`.
- Exactly one `#appVersion`.
- Version is V5.3.59 in index and 5.3.59 in APP_VERSION.
- No visible `Master admin` / `master-admin` wording in HTML/CSS/JS.
- Profile card is after `</main>` and before import control.
- Admin action handlers for Approve, Reject, Suspend and Delete are present.

## Supabase advisor notes
- Leaked Password Protection remains disabled.
- Supabase security advisor reports authenticated SECURITY DEFINER warnings for the two guarded RPCs; both are explicitly restricted to authenticated users and perform authorization checks before privileged operations.
- Existing RLS performance notices remain and were not mixed into this functional fix.
