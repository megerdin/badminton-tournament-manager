# Badminton Tournament Manager — Supabase Setup

## Current state

The application is ready for connection to a real Supabase project. No old LocalStorage data is migrated automatically.

The browser uses only the Supabase **Project URL** and **Publishable key**. Never put a Supabase Secret key, service-role key, database password, or personal access token into this project.

## 1. Create a Supabase project

Create a new Supabase project using the Free plan if that is the intended starting point.

## 2. Run the database scripts

In the Supabase SQL Editor, run these files in order:

1. `supabase/schema.sql`
2. `supabase/policies.sql`

Then sign up the owner's account through the application.

After the account exists, copy that user's UUID from Supabase Authentication > Users and put it into `supabase/bootstrap_master_admin.sql` in place of `YOUR_USER_UUID`.

Run the bootstrap SQL once.

## 3. Authentication settings

For the initial production configuration:

- Email/password authentication: enabled
- Email confirmation: enabled
- New user sign-up: enabled
- Anonymous sign-in: not required
- Password reset: enabled

The application then applies a second gate: a newly registered account remains `pending` until the master administrator approves it.

## 4. Reduce automated signup abuse

For a public deployment, enable Supabase Auth CAPTCHA protection for sign-up, sign-in and password-reset flows. Supabase currently supports hCaptcha and Cloudflare Turnstile.

Keep the built-in Auth rate limits enabled.

## 5. Configure the application

Open:

`js/storage.js`

Set:

```js
window.BADMINTON_CLOUD_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "sb_publishable_..."
};
```

The publishable key is intentionally browser-visible. RLS is the security boundary.

Do **not** use a `sb_secret_...` key here.

## 6. Authentication URL configuration

Set the Supabase Auth Site URL to the final application URL.

Add the final application URL to the allowed redirect URLs.

For local testing, also add the local HTTP URL you actually use, for example:

`http://localhost:8000/`

## 7. First-user flow

1. Open the application.
2. Create the owner's account.
3. Confirm the email if confirmation is enabled.
4. Run `bootstrap_master_admin.sql` once with that account's UUID.
5. Sign in again.
6. The account should show as approved/master admin.
7. A second test account can then be created.
8. The second account should remain pending until approved by the master admin.

## 8. Security model

The application never trusts the browser UI for approval or ownership.

Database RLS controls access to:

- profiles
- clubs
- tournaments
- tournament_members

Approval and master-admin checks are enforced in database policies/functions.

## 9. Offline behaviour

If Supabase is unavailable, the existing tournament engine continues using LocalStorage as the local cache/offline working copy. Changes are queued for later synchronization.

## 10. Do not migrate old LocalStorage data

This project deliberately starts with a fresh cloud database. Existing LocalStorage data is not imported into Supabase automatically.

The existing JSON Export/Import functionality remains available as an independent backup/transfer mechanism.
