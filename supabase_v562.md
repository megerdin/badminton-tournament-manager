# Supabase Configuration — Badminton Tournament Manager

**Final application version: V5.3.62**

This document records the **final Supabase architecture, database structure, authentication model, security model, and operational configuration** used by the Badminton Tournament Manager.

It is intended as the technical reference for maintaining the Supabase side of the application.

---

## 1. Architecture

The application uses a:

> **Supabase cloud-primary architecture with localStorage cache and offline fallback.**

Supabase is the authoritative persistent cloud database when connected.

localStorage is used for:

- Local cache
- Fast local interaction
- Offline/poor-connectivity operation
- Pending cloud-sync queue

The tournament engine continues to operate on its in-memory state. The storage layer synchronizes that state with Supabase.

```text
                         ┌─────────────────────┐
                         │  Tournament Engine  │
                         │ teams / groups /    │
                         │ fixtures / results /│
                         │ rankings / knockout │
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                         │    Storage Layer    │
                         └──────────┬──────────┘
                                    │
                       ┌────────────┴────────────┐
                       │                         │
                    connected                offline
                       │                         │
                ┌──────▼──────┐          ┌──────▼─────────┐
                │  Supabase   │          │  localStorage  │
                │ PostgreSQL  │          │ cache + queue  │
                │ AUTHORITATIVE│         │ offline copy   │
                └─────────────┘          └───────┬─────────┘
                                                  │
                                           connection returns
                                                  │
                                                  ▼
                                             Supabase sync
```

### Online flow

```text
User change
    ↓
Tournament engine updates state
    ↓
Local cache updated
    ↓
Cloud save / synchronization
    ↓
Supabase remains authoritative
```

### Offline flow

```text
User change
    ↓
Tournament engine updates state
    ↓
localStorage updated
    ↓
Change placed in pending queue
    ↓
Application continues working
    ↓
Connection returns
    ↓
Pending changes synchronized with Supabase
```

This is not a traditional local-first database architecture in which localStorage is the authoritative database.

---

## 2. Supabase project

Current project:

```text
Project name:  Badminton
Project ref:   tumqpsbwelmwawbkqtjh
Region:        eu-west-2
Status:        ACTIVE_HEALTHY
```

Project URL:

```text
https://tumqpsbwelmwawbkqtjh.supabase.co
```

Database:

```text
PostgreSQL 17.6.1.166
```

The browser application uses the project's **publishable key**.

### Secret handling

The following must never be placed in the browser application, GitHub repository, HTML, JavaScript or CSS:

```text
service_role key
secret keys
database passwords
```

Only the Supabase project URL and publishable client key belong in the browser-side configuration.

---

## 3. Database tables

The application uses four primary public tables:

```text
profiles
clubs
tournaments
tournament_members
```

All four have Row Level Security enabled.

---

## 4. `profiles`

The `profiles` table represents the application account/profile.

It stores:

```text
id
email
display_name
club_name
city
role
approval_status
created_at
approved_at
approved_by
```

### Role values

Internal role values:

```text
user
master_admin
```

The GUI deliberately does not expose the internal name `master_admin`.

The GUI displays:

```text
Admin
```

### Approval states

```text
pending
approved
rejected
suspended
```

A newly registered user starts as:

```text
pending
```

An Admin must approve the account before the user can use the cloud tournament application.

---

## 5. `clubs`

The `clubs` table stores clubs owned by users.

Conceptually:

```text
clubs
├── id
├── owner_id
├── name
├── created_at
└── updated_at
```

The club owner relationship is used by RLS to determine whether an authenticated user may manage a club.

---

## 6. `tournaments`

The `tournaments` table stores the persistent tournament document.

Conceptually:

```text
tournaments
├── id
├── club_id
├── name
├── data          JSONB
├── version
├── created_at
├── updated_at
└── updated_by
```

### JSONB tournament document

The existing tournament engine remains largely intact.

The following tournament data is stored inside `data`:

- Teams
- Players
- Groups
- Fixtures
- Results
- Tournament settings
- Categories
- Tournament state
- Other existing tournament-engine data

### Data classification

#### Authoritative data

```text
teams
players
groups
fixtures
results
tournament/category configuration
```

#### Derived data

```text
group standings
qualification
tournament ranking
podium
```

#### Generated structures

```text
group fixtures
Pre-Knockout
Main Knockout
3rd-place playoff
```

---

## 7. Tournament versioning

Each cloud tournament has a numeric `version`.

The storage layer uses this version to protect against overwriting a newer cloud state.

General save flow:

```text
Read cloud version
       ↓
Compare with local queued baseVersion
       ↓
If equal:
    update cloud with version + 1
       ↓
If different:
    report sync conflict
```

A cloud/local version mismatch must not silently overwrite newer cloud data.

---

## 8. `tournament_members`

This table controls tournament-level access.

Current roles:

```text
viewer
editor
owner
```

The tournament owner can manage membership.

Users can access tournaments according to their assigned tournament role and the applicable RLS policy.

---

## 9. Row Level Security

RLS is enabled on:

```text
public.profiles
public.clubs
public.tournaments
public.tournament_members
```

The security model is based on authenticated identity, profile approval, ownership and tournament membership.

### Profiles

Users may access their own profile.

Admin access is separately protected.

### Clubs

Club ownership controls normal user access.

### Tournaments

Tournament access is based on:

```text
owner
editor
viewer
Admin
```

Approved users may create/manage their own tournament through the protected ownership path.

### Tournament members

Membership changes are restricted to authorized tournament owners/Admins.

---

## 10. Protected helper functions

Authorization logic is kept in the private schema where appropriate.

Current protected helper functions include:

```text
private.is_approved_user()
private.is_master_admin()
private.is_tournament_owner(uuid)
private.has_tournament_role(uuid, text[])
private.is_club_owner(uuid)
```

These functions are owned by the PostgreSQL administrator role and use `SECURITY DEFINER` where required.

They use a controlled search path:

```text
public, pg_temp
```

The private schema is not intended to be exposed as a normal application API.

---

## 11. Admin approval

The application exposes a protected RPC:

```text
public.admin_set_approval(uuid, text)
```

The RPC:

1. Verifies that the caller is an approved Admin.
2. Validates the requested approval state.
3. Prevents the Admin from suspending/rejecting itself.
4. Updates the target user's profile.
5. Records the approving Admin when approving.

Allowed states:

```text
pending
approved
rejected
suspended
```

The Admin GUI provides actions according to the current account state:

```text
Approve
Reject
Suspend
Delete
```

The Admin cannot perform destructive account actions against its own account.

---

## 12. Admin account deletion

The application uses the protected RPC:

```text
public.admin_delete_user(uuid)
```

The function is `SECURITY DEFINER` and performs its own Admin authorization check.

The Admin cannot delete itself.

The browser does not receive a service-role key.

The purpose of the RPC is to keep privileged account deletion on the server side rather than trusting the browser.

---

## 13. Initial tournament creation

Approved users create their initial cloud tournament through the protected RPC:

```text
public.create_initial_tournament(uuid)
```

The function verifies:

```text
caller is approved
AND
caller owns the specified club
```

Only then is the initial tournament created.

The current architecture uses one primary tournament record per club, protected by a unique index on:

```text
tournaments(club_id)
```

---

## 14. Signup flow

New account:

```text
Sign up
   ↓
Name
Club name
City
Email
Password
   ↓
Supabase Auth account
   ↓
profile created by Auth trigger
   ↓
approval_status = pending
   ↓
Admin reviews request
   ↓
Approve / Reject
```

The Auth trigger populates:

```text
display_name
club_name
city
email
```

from the signup metadata.

This allows the Admin to identify a signup request without exposing authentication secrets.

---

## 15. Auth profile trigger

The current Auth trigger is:

```text
public.handle_new_user()
```

It creates/updates the corresponding `public.profiles` row when a new Supabase Auth user is created.

The trigger reads:

```text
raw_user_meta_data.display_name
raw_user_meta_data.club_name
raw_user_meta_data.city
```

and stores cleaned values in the profile.

The trigger is a `SECURITY DEFINER` function with a controlled search path.

---

## 16. Authentication states in the application

### Signed out

The user sees:

```text
Badminton Tournament Manager

Sign in to use the cloud version V5.3.62.

Email address
Password

Sign in    Sign up

Forgot password?
```

### Pending

The user can authenticate but is blocked from cloud tournament use.

Message:

```text
Awaiting for Admin approval.
```

### Approved

The user may access the cloud tournament application subject to tournament ownership/membership rules.

### Rejected / suspended

Cloud application access is blocked according to the account state.

---

## 17. Session security

The application implements a default:

```text
30 minutes of inactivity
```

After inactivity, the application signs out the current Supabase session.

The application uses the local session scope for normal sign-out so signing out of one browser does not intentionally terminate other sessions.

The application-level timeout is separate from Supabase's server-side session settings.

---

## 18. Cloud sync

Cloud synchronization is handled by the application storage layer.

Important states include:

```text
Cloud synced
Syncing…
Sync pending
Offline — changes saved locally
Sync conflict
```

When offline, changes remain usable locally and are queued for later synchronization.

When connectivity returns, the pending snapshot is checked against the current cloud version before it is written.

---

## 19. Conflict protection

The application uses a base cloud version for queued snapshots.

Example:

```text
Cloud version: 35
Local change based on: 35
```

If the cloud is still version 35:

```text
local snapshot
    ↓
cloud becomes 36
```

If the cloud is already version 36:

```text
local baseVersion = 35
cloud version     = 36

→ conflict
```

The application must not silently overwrite the newer cloud version.

---

## 20. No realtime requirement

The final architecture does not require Supabase Realtime.

The application uses explicit reads/writes and version checking.

This keeps the current implementation simpler and avoids adding realtime synchronization complexity that is not required for the present tournament workflow.

---

## 21. LocalStorage relationship

The existing localStorage key remains:

```text
badmintonTournamentManager.v1
```

The cloud version does not automatically migrate old localStorage tournaments into Supabase.

Existing JSON:

```text
Export
Import
```

remains the manual backup/recovery mechanism.

localStorage is therefore:

```text
cache
+
offline working copy
+
pending sync support
```

It is not the primary persistent cloud database.

---

## 22. Current production data

At the final verification stage, the Supabase project contained:

```text
profiles:             1
clubs:                1
tournaments:          1
tournament_members:   1
```

The original Admin account is:

```text
role:            master_admin
approval_status: approved
```

The internal role is intentionally displayed as:

```text
Admin
```

in the GUI.

---

## 23. Current database security checks

The database has RLS enabled on all four application tables.

The final verification confirmed that:

- Protected Admin approval works through the authenticated path.
- Unauthorized Admin operations are rejected.
- Approved users can pass the protected initial-tournament authorization path.
- Anonymous access to privileged RPCs is revoked.
- Admin self-protection is enforced server-side.

### Remaining Supabase advisor items

The Supabase security advisor currently reports:

```text
Leaked Password Protection Disabled
```

This is an Auth configuration recommendation concerning compromised-password checking.

The database advisor also reports non-blocking performance recommendations concerning:

- RLS initialization plans
- Foreign-key indexes
- One currently unused index
- Multiple permissive policies

These are performance/maintenance recommendations and are separate from the core application authorization model.

---

## 24. Important security rules

Never:

```text
put service_role in JavaScript
put service_role in HTML
put database passwords in GitHub
bypass RLS for convenience
trust browser role information for authorization
```

Always:

```text
use the publishable browser key
use RLS
use server-side authorization for privileged operations
validate Admin privileges on the server
validate ownership on the server
```

---

## 25. Supabase files in the repository

The application keeps the database definitions alongside the application:

```text
supabase/
├── schema.sql
├── policies.sql
└── bootstrap_master_admin.sql
```

### `schema.sql`

Defines the application database structure.

### `policies.sql`

Defines:

- RLS
- protected helper functions
- policies
- privileged RPCs
- required grants

### `bootstrap_master_admin.sql`

Used to establish the initial internal Admin account.

The bootstrap script must not contain browser-exposed secrets.

---

## 26. Connecting the application to Supabase

This section explains how the browser application connects to the Supabase project. It is separate from creating the database schema and security policies.

### 26.1 What the browser needs

The application needs only two browser-safe Supabase values:

```text
Supabase project URL
Supabase publishable key
```

For the current production project:

```text
Project URL:
https://tumqpsbwelmwawbkqtjh.supabase.co
```

The publishable key is obtained from the Supabase project's API settings. Use the current **publishable key** shown by Supabase; do not copy a `service_role` or secret key.

### 26.2 How the connection works

The application uses the Supabase JavaScript client in the browser.

Conceptually:

```text
Browser application
        ↓
Supabase JavaScript client
        ↓
Project URL + publishable key
        ↓
Supabase Auth / Data API
        ↓
PostgreSQL
```

The browser key identifies the Supabase project and is intentionally public. **RLS is what protects the database rows and operations.** A publishable key is not a replacement for database security policies.

### 26.3 Application files involved

The connection is deliberately kept behind the application boundaries:

```text
js/auth.js
    → Supabase Auth connection
    → sign in / sign up / session / password operations

js/storage.js
    → Supabase database connection
    → cloud reads / writes / sync / conflict handling

js/app.js
    → application startup and orchestration
```

The tournament engine in `js/tournament.js` should not contain direct Supabase database calls. This keeps tournament logic independent from the persistence mechanism.

### 26.4 Connect a fresh copy of the application

For a new deployment of this application:

**Step 1 — Open the Supabase project**

Use the Supabase project associated with the application:

```text
Project:
Badminton

Project ref:
tumqpsbwelmwawbkqtjh
```

**Step 2 — Obtain the project URL**

Use:

```text
https://tumqpsbwelmwawbkqtjh.supabase.co
```

If using another Supabase project, use that project's own URL instead.

**Step 3 — Obtain the publishable key**

In the Supabase project, open the project's API/connect settings and copy the browser-safe **publishable key**.

Do not use:

```text
service_role
secret key
database password
```

**Step 4 — Configure the browser client**

Put the project URL and publishable key into the application's existing Supabase client configuration in the JavaScript source.

The configuration should conceptually be:

```text
SUPABASE_URL  = project URL
SUPABASE_KEY  = publishable key
```

Do not create a second database connection in individual UI functions. All Supabase access should continue through the existing Auth/Storage boundaries.

**Step 5 — Prepare the database**

Before expecting the application to work against a new project, run the repository SQL in this order:

```text
1. supabase/schema.sql
2. supabase/policies.sql
3. supabase/bootstrap_master_admin.sql
```

`schema.sql` creates the database structure.

`policies.sql` creates RLS, authorization helpers, policies, privileged functions and grants.

`bootstrap_master_admin.sql` establishes the initial Admin account as documented by the project.

**Step 6 — Configure Supabase Auth URLs**

The deployed application's URL must be configured in the Supabase Auth URL settings so that authentication redirects return to the application.

Current application URL:

```text
https://megerdin.github.io/badminton-tournament-manager/
```

If the application is moved to another domain, update the Supabase Auth URL configuration to match the new deployment before testing password reset or authentication redirects.

**Step 7 — Deploy the application**

Deploy the complete application while preserving the repository structure:

```text
index.html
css/
js/
supabase/
```

The current application does not require a build step.

**Step 8 — Test the connection**

Perform the following end-to-end test:

```text
Open application
      ↓
Sign up / sign in
      ↓
Supabase Auth session created
      ↓
Profile loaded
      ↓
Approval checked
      ↓
Cloud tournament loaded/created
      ↓
Make a tournament change
      ↓
Local cache updated
      ↓
Supabase cloud save
      ↓
Reload application
      ↓
Confirm the cloud state is restored
```

Also test offline behavior:

```text
Disconnect network
      ↓
Make a tournament change
      ↓
Confirm local save / pending sync
      ↓
Reconnect network
      ↓
Confirm synchronization with Supabase
```

### 26.5 Important: the key does not grant database access by itself

Because the application is a browser application, the publishable key can be visible to users. This is expected.

Security must therefore come from:

```text
Supabase Auth
      +
Row Level Security
      +
server-side authorization functions
      +
ownership / membership checks
```

Never attempt to hide a publishable key as if it were a password. Instead, ensure the RLS policies and protected functions correctly prevent unauthorized access.

### 26.6 Never connect the browser with privileged credentials

The following must **never** appear in:

```text
index.html
JavaScript
CSS
GitHub
browser localStorage
browser developer tools configuration
```

```text
service_role key
Supabase secret key
database password
```

If a privileged credential is ever exposed in the repository or browser application, rotate/revoke it immediately and replace the affected configuration.

### 26.7 New Supabase project versus existing production project

There are two different operations and they should not be confused.

**Use the existing production project when:**

```text
Project ref = tumqpsbwelmwawbkqtjh
```

The existing production database, users, tournaments and authorization configuration are retained.

**Use a new Supabase project when:**

```text
A separate test/development environment is required
```

In that case, the new project's URL and publishable key must be configured, and all repository SQL must be applied to that project. The production project's credentials and data should not be copied into a development environment unnecessarily.

### 26.8 Connection checklist

Before declaring a deployment connected:

```text
[ ] Correct Supabase project selected
[ ] Correct project URL configured
[ ] Publishable key configured
[ ] No service_role/secret key in browser code
[ ] schema.sql applied
[ ] policies.sql applied
[ ] Initial Admin/bootstrap completed where required
[ ] Supabase Auth redirect URL configured
[ ] Sign in tested
[ ] Approval flow tested
[ ] Cloud tournament read tested
[ ] Cloud tournament write tested
[ ] Page reload restores cloud data
[ ] Offline save tested
[ ] Reconnection/sync tested
[ ] RLS unauthorized access tested
```

## 27. Deployment relationship

The application is a static web application.

```text
GitHub Pages / static host
          │
          │ publishable key
          ▼
      Supabase API
          │
          ▼
      PostgreSQL
```

The browser communicates with Supabase through its public API using the publishable key.

RLS and server-side functions enforce authorization.

---

## 28. Final architecture summary

```text
┌─────────────────────────────────────────────────────┐
│                  Browser Application                │
│                                                     │
│  index.html                                         │
│  app.css                                            │
│  app.js                                             │
│  tournament.js                                      │
│  ui.js                                              │
│  auth.js                                            │
│  storage.js                                         │
│                                                     │
│  Tournament engine                                  │
└──────────────────────────┬──────────────────────────┘
                           │
                    Storage/Auth layer
                           │
             ┌─────────────┴─────────────┐
             │                           │
        Online                        Offline
             │                           │
             ▼                           ▼
       ┌───────────┐              ┌────────────┐
       │ Supabase  │              │ localStorage│
       │ PostgreSQL│              │ cache/queue │
       │ AUTHORIT. │              └─────┬──────┘
       └───────────┘                    │
             ▲                           │
             └────── synchronization ───┘
```

The final design therefore remains:

> **Supabase cloud-primary, with localStorage cache/offline fallback.**

---

## 29. Final release reference

```text
Application:
Badminton Tournament Manager

Version:
V5.3.62

Cloud:
Supabase

Database:
PostgreSQL

Architecture:
Supabase cloud-primary + localStorage offline fallback

Authentication:
Supabase Auth

Authorization:
RLS + protected server-side functions

Tournament storage:
JSONB document

Cloud conflict protection:
Version-based

Realtime:
Not required

Offline support:
localStorage + pending sync queue

Session inactivity:
30 minutes

GUI Admin label:
Admin

Internal Admin role:
master_admin

License:
MIT

Developer:
Ruhul Amin
```

---

## 30. Maintenance rule

Before making future Supabase changes:

1. Inspect the existing schema.
2. Inspect existing RLS policies.
3. Inspect protected functions and grants.
4. Preserve existing authorization behavior.
5. Make the smallest required change.
6. Test both authorized and unauthorized paths.
7. Re-run Supabase security/performance advisors.
8. Update this document when the architecture or security model changes.

Do not make database changes merely to remove an advisor warning if the change would weaken the application's security model.

---

**Final Supabase reference for Badminton Tournament Manager V5.3.62.**
