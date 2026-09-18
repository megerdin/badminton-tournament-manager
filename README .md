# Badminton Tournament Manager

**Final application version: V5.3.62**

A mobile-first badminton tournament management application designed to
manage a complete tournament from team/player entry through group
stages, qualification, knockout stages, results, rankings and podium.

The application is a browser-based web app with a local-first data model
and optional Supabase cloud persistence.

------------------------------------------------------------------------

## Features

### Tournament management

-   Club name and tournament identity
-   Tournament categories
-   Team and player entry
-   Team Pool
-   Player Pool
-   Special-team/player-pool workflow
-   Group creation and management
-   Automatic round-robin group fixture generation
-   Match result entry
-   Group standings
-   Qualification management
-   Tournament-wide ranking
-   Pre-Knockout
-   Main Knockout
-   Automatic knockout bracket sizing
-   3rd-place playoff
-   Podium
-   Tournament status/progress
-   Tournament settings
-   Fixture PDF generation

### Tournament formats

The application supports the existing tournament configuration model,
including:

-   Singles / Doubles
-   Best-of-1 and the existing game-format options
-   Configurable points per game
-   Configurable groups and team counts
-   Configurable qualification settings
-   Pre-Knockout and Main Knockout stages

The application intentionally does not enforce detailed badminton
deuce/target/maximum-score rules.

------------------------------------------------------------------------

## Data architecture

The application uses a **Supabase cloud-primary architecture with localStorage cache and offline fallback**.

The important distinction is:

- **Supabase = authoritative persistent cloud database when connected**
- **localStorage = local cache and offline working copy**
- **Tournament engine = operates on the application's in-memory tournament state**
- **Storage/sync layer = synchronizes local state with Supabase**
- **Offline changes = stored locally and queued for synchronization when connectivity returns**

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

### Online

```text
User change
    ↓
Existing tournament engine updates state
    ↓
local cache updated
    ↓
Supabase save / sync
    ↓
Supabase remains authoritative
```

### Offline or poor connection

```text
User change
    ↓
Existing tournament engine updates state
    ↓
localStorage updated
    ↓
Change placed in pending sync queue
    ↓
Application continues working
    ↓
Connection returns
    ↓
Pending changes synchronized with Supabase
```

This is **not** a traditional local-first database architecture in which localStorage is the authoritative database and the cloud is merely a backup. Supabase is the primary persistent cloud store; localStorage exists to provide fast local interaction, caching and continuity during connectivity problems.

------------------------------------------------------------------------

## Storage model

The application stores the tournament as a JSON document in the
`tournaments.data` JSONB column.

This deliberately keeps the existing tournament engine intact rather
than splitting every tournament entity into separate relational tables.

### Authoritative tournament data

-   Teams
-   Players
-   Groups
-   Fixtures
-   Results
-   Tournament/category configuration

### Derived data

-   Group standings
-   Qualification
-   Tournament ranking
-   Podium

### Generated structures

-   Group fixtures
-   Pre-Knockout
-   Main Knockout
-   3rd-place playoff

Generated structures use build/dependency information so downstream
stages can be invalidated and rebuilt when their source results change.

------------------------------------------------------------------------

## Local storage

The existing application local storage model is retained.

The primary tournament cache key is:

``` text
badmintonTournamentManager.v1
```

The application also maintains cloud-sync queue/profile information in
localStorage where required.

### Important

The cloud version does **not** perform an automatic migration of old
localStorage tournaments into Supabase.

Existing JSON Export/Import remains available as the application's
emergency/manual backup mechanism.

------------------------------------------------------------------------

## Supabase architecture

The cloud database contains four primary application tables:

``` text
profiles
clubs
tournaments
tournament_members
```

### profiles

Stores:

-   User ID
-   Email
-   Display name
-   Club name
-   City
-   Internal role
-   Approval status
-   Approval timestamp
-   Approving administrator

Internal role values include:

``` text
user
master_admin
```

The GUI deliberately displays the latter as:

``` text
Admin
```

The term **Master admin** is not exposed in the application GUI.

### clubs

Stores the club owned by a user.

### tournaments

Stores:

-   Club relationship
-   Tournament name
-   Tournament JSON document
-   Cloud version
-   Creation/update timestamps
-   Last updating user

A unique constraint ensures one primary tournament record per club in
the current architecture.

### tournament_members

Stores tournament-level access:

``` text
viewer
editor
owner
```

------------------------------------------------------------------------

## Authentication

The cloud version requires a Supabase-authenticated account.

### Sign in

The login screen contains:

``` text
Badminton Tournament Manager
Sign in to use the cloud version V5.3.62.

Email address
Password

Sign in    Sign up

Forgot password?
```

### Sign up

New users provide:

-   Name
-   Club name
-   City
-   Email address
-   Password

Signup information is stored in the user's profile so an Admin can
identify the request.

### Approval

New accounts start with:

``` text
pending
```

The user cannot use the cloud tournament application until an Admin
approves the account.

The user-facing waiting message is:

``` text
Awaiting for Admin approval.
```

Available account states are:

``` text
pending
approved
rejected
suspended
```

------------------------------------------------------------------------

## Admin user management

The application's Profile section contains the Admin user-management
area for an Admin account.

Available actions depend on account state and include:

``` text
Approve
Reject
Suspend
Delete
```

The Admin cannot suspend, reject or delete their own account.

Administrative operations are protected by server-side authorization
checks.

------------------------------------------------------------------------

## Profile

The signed-in account controls are contained in one **Profile** section
at the bottom of the application.

The section contains:

-   Signed-in user's name
-   Cloud sync status
-   Change password
-   Sign out
-   Admin user accounts, when applicable
-   User account information and approval status

Example:

``` text
Profile

Ruhul Amin
Cloud synced

Change password
Sign out

Admin — user accounts

Ruhul Amin
megerdin@gmail.com
Admin · approved

Amin
Magpie · London · megerdin@hotmail.com
User · approved
```

The Profile section is part of the main scrollable application content
and is positioned after the main application sections.

------------------------------------------------------------------------

## Session security

The application implements a default **30-minute inactivity timeout**.

Activity is tracked in the browser and the current Supabase session is
signed out locally after the inactivity period.

The sign-out operation uses the current-session scope so that signing
out from one browser does not intentionally terminate other sessions.

------------------------------------------------------------------------

## Cloud sync and conflict handling

Cloud saves use a versioned tournament document.

The storage layer tracks the cloud version and queued local changes.

The general model is:

``` text
local change
    ↓
queue snapshot
    ↓
cloud version check
    ↓
cloud update
```

If a cloud/local version conflict is detected, the application can
present the existing conflict controls so the user can choose between
retaining local changes and using the cloud version.

No realtime subscription is required by the current architecture.

------------------------------------------------------------------------

## Security model

The browser uses only the Supabase **publishable key**.

A Supabase `service_role` or secret key must never be placed in:

-   HTML
-   JavaScript
-   CSS
-   GitHub
-   browser configuration

Row Level Security (RLS) is enabled on:

``` text
profiles
clubs
tournaments
tournament_members
```

The database uses protected helper functions and authorization checks
for privileged operations such as:

-   Admin approval
-   Admin account deletion
-   Initial tournament creation

The application does not rely on the browser alone to decide whether a
user is an Admin or whether a user may access a tournament.

------------------------------------------------------------------------

## Project structure

``` text
badminton/
├── index.html
├── css/
│   └── app.css
├── js/
│   ├── app.js
│   ├── auth.js
│   ├── storage.js
│   ├── tournament.js
│   └── ui.js
└── supabase/
    ├── schema.sql
    ├── policies.sql
    └── bootstrap_master_admin.sql
```

### `index.html`

Application shell and HTML structure.

### `css/app.css`

Application styling and responsive/mobile-first presentation.

### `js/app.js`

Application startup and high-level orchestration.

### `js/tournament.js`

Tournament engine containing:

-   State
-   Teams
-   Players
-   Player Pool
-   Groups
-   Fixtures
-   Results
-   Standings
-   Qualification
-   Tournament ranking
-   Pre-Knockout
-   Main Knockout
-   3rd-place playoff
-   Podium
-   Categories
-   Tournament calculations

### `js/ui.js`

UI rendering and interaction layer, including:

-   Tournament sections
-   Score entry
-   Dashboard/status
-   Messages
-   PDF fixture generation
-   Reports and display updates

### `js/storage.js`

Persistence boundary containing:

-   localStorage
-   Supabase connection
-   cloud saves
-   local cache
-   offline queue
-   sync
-   version handling
-   conflict handling

### `js/auth.js`

Authentication boundary containing:

-   Sign in
-   Sign up
-   Approval gating
-   Profile loading
-   Password reset
-   Change password
-   Sign out
-   Inactivity timeout
-   Admin user management

------------------------------------------------------------------------

## Supabase setup

For a fresh Supabase project:

### 1. Create the database schema

Run:

``` text
supabase/schema.sql
```

### 2. Apply security policies

Run:

``` text
supabase/policies.sql
```

### 3. Configure the initial Admin

Use:

``` text
supabase/bootstrap_master_admin.sql
```

The bootstrap script is for establishing the initial internal
`master_admin` account.

### 4. Configure the browser client

The application uses:

``` text
Supabase project URL
Supabase publishable key
```

Only the publishable/anonymous client key belongs in the browser.

Never use a service-role/secret key in the application.

------------------------------------------------------------------------

## Deployment

The application is a static web application and can be hosted by a
static web host such as GitHub Pages.

The repository must preserve the directory structure:

``` text
index.html
css/
js/
supabase/
```

No build system is required by the current application.

After deployment, verify that the browser is loading the intended
version by checking the version shown on the login screen and in the
application.

------------------------------------------------------------------------

## PDF fixture export

The application can generate a printable fixture PDF.

Current fixture PDF typography:

``` text
Club name:
18pt

Group fixture heading:
14pt
```

Current example:

``` text
Tower hamlet badminton club
18pt

Group A — Group Fixtures
14pt
```

The PDF no longer includes:

``` text
Blank cells are provided for fixture entries.
```

------------------------------------------------------------------------

## Backup

The application retains its existing JSON:

``` text
Export
Import
```

workflow.

Users should periodically export tournament data as a manual backup,
especially before major tournament changes.

Cloud persistence does not replace the usefulness of a separate exported
backup.

------------------------------------------------------------------------

## Versioning

Current final version:

``` text
V5.3.62
```

Version consistency is maintained in:

``` text
index.html
APP_VERSION
```

The login screen also displays the current application version.

Previous application versions should be preserved rather than
overwritten during development.

------------------------------------------------------------------------

## Development principles

The project follows these principles:

1.  Preserve existing tournament functionality.
2.  Keep the tournament engine independent from persistence.
3.  Keep cloud functionality behind the storage/auth boundaries.
4.  Keep localStorage as the offline fallback.
5.  Avoid unnecessary database normalization while the JSON tournament
    document remains sufficient.
6.  Protect cloud operations with RLS and server-side authorization.
7.  Keep the interface compact and mobile-first.
8.  Make settings changes preserve existing tournament data where the
    application supports changing those settings.
9.  Version releases sequentially.
10. Run regression checks before each release.

------------------------------------------------------------------------

## Known non-blocking technical notes

The current application intentionally retains some legacy/compatibility
code from the original tournament engine.

Examples include:

-   Legacy exception/playoff configuration retained for compatibility
-   Existing inline event handlers
-   Some duplicated theme CSS retained
-   Duplicate player-name validation is not enforced in the
    special-team/player-pool workflow
-   Detailed badminton deuce/target/maximum-score enforcement is not
    implemented

These are not required for the current application workflow and should
not be removed casually without regression testing.

------------------------------------------------------------------------

## License

Developed by **Ruhul Amin**.

Licensed under the **MIT License**.

Copyright © 2026 Ruhul Amin.

Permission is granted, free of charge, to any person obtaining a copy of
this software and associated documentation files, to deal in the
software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the software, subject to the conditions of the MIT License.

The full MIT license terms should be retained with the project when
distributing the application.

------------------------------------------------------------------------

## Final release

``` text
Application: Badminton Tournament Manager
Version:     V5.3.62
Architecture: Supabase cloud-primary + localStorage offline fallback
Primary UI:   Mobile-first
License:      MIT
Developer:    Ruhul Amin
```

This README describes the final V5.3.62 application structure and the
cloud/local architecture shipped with this release.
