-- ONE-TIME bootstrap for the first master administrator.
--
-- 1. Sign up the owner's account in the application.
-- 2. In Supabase Dashboard -> Authentication -> Users, copy that user's UUID.
-- 3. Replace YOUR_USER_UUID below and run this script once in the SQL editor.
-- 4. Do not put a service-role/secret key into the HTML or GitHub.
--
-- This script is intended for the database owner/SQL editor, not for the browser.

update public.profiles
set role = 'master_admin',
    approval_status = 'approved',
    approved_at = now(),
    approved_by = id
where id = 'YOUR_USER_UUID'::uuid;

-- Verify one row was updated in the SQL editor before using the app.
