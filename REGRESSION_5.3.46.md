# Badminton Tournament Manager — v5.3.46 Regression

## Purpose
Security hardening of the master-admin approval RPC without changing the browser workflow.

## Defect found
`public.admin_set_approval(uuid,text)` was a `SECURITY DEFINER` RPC exposed to the `authenticated` role. Supabase Advisor correctly flagged this as a security warning.

## Fix
- Changed `admin_set_approval(uuid,text)` to `SECURITY INVOKER`.
- Added a `profiles_update_master_admin` RLS policy restricted to `private.is_master_admin()`.
- Kept the RPC's explicit master-admin authorization check.
- Kept the existing self-suspension/rejection protection and status validation.
- Kept the existing trigger protecting profile security fields.
- No client-side auth workflow change: `auth.js` continues calling the same RPC with the same parameters.

## Live verification
- `admin_set_approval(uuid,text)` is now SECURITY INVOKER.
- `authenticated` retains EXECUTE so the browser admin workflow can call it.
- `anon` does not have EXECUTE.
- Master-admin UPDATE policy exists with both USING and WITH CHECK.
- Supabase security advisor no longer reports `authenticated_security_definer_function_executable`.
- Remaining advisor warning is only leaked-password protection being disabled.

## Regression
- All JavaScript files pass `node --check`.
- Tournament engine unchanged apart from version constant.
- LocalStorage/cloud persistence unchanged.
- Auth client RPC call unchanged.
- v5.3.7 baseline remains untouched.
- Browser runtime smoke test remains unavailable in this execution environment because Chromium hangs before producing usable DOM output.
