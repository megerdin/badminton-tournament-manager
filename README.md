# Badminton Tournament Manager

**Current version: V6.1.6**

A mobile-first, browser-based badminton tournament management application for managing players, teams, groups, fixtures, results, rankings, qualification and knockout stages.

The application is designed primarily for use on mobile phones and tablets, while remaining fully usable on desktop browsers.

## Live Application

GitHub Pages:

https://megerdin.github.io/badminton-tournament-manager/

## Features

### Tournament Management

- Club and tournament identity
- Multiple independent tournament categories
- Category-specific tournament settings
- Player registration
- Team registration
- Player Pool
- Team Pool
- Group creation and team allocation
- Automatic round-robin fixture generation
- Match result entry
- Group standings
- Qualification management
- Tournament-wide rankings
- Pre-Knockout stage
- Main Knockout stage
- Third-place playoff
- Podium and tournament results
- Tournament progress/status information

### Match Configuration

- Best-of-1, Best-of-3 and Best-of-5
- Configurable points target
- Game-by-game score entry
- Category-level defaults
- Match-level scorecard configuration
- Flexible scoring configuration

### Categories

Each tournament category operates independently.

For example:

```text
Club
│
├── Category 1 — C & D
├── Category 2
├── Category 3
└── Category 4
```

Each category maintains its own:

- Players
- Teams
- Groups
- Fixtures
- Results
- Rankings
- Qualification
- Knockout stages
- Tournament settings

The category can be switched by clicking the top application banner.

The banner colour changes according to the selected category to provide a clear visual indication of the active category.

## Data Architecture

The application uses a **Supabase cloud-primary architecture with localStorage as the local cache and offline fallback**.

```text
                    ┌──────────────────────┐
                    │   Tournament Engine  │
                    │                      │
                    │ Players / Teams      │
                    │ Groups / Fixtures    │
                    │ Results / Rankings   │
                    │ Knockout / Podium    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │    Storage Layer     │
                    └──────────┬───────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
        ┌─────────▼─────────┐     ┌────────▼────────┐
        │     Supabase      │     │   localStorage  │
        │  Primary storage  │     │ Cache / Offline │
        └───────────────────┘     └─────────────────┘
```

### Cloud-first behaviour

When an internet connection is available:

- Supabase is the authoritative data source.
- The application loads the cloud workspace when starting.
- Local stale data is not treated as authoritative.
- Saving replaces the complete cloud workspace.
- All categories are saved together.

When the application is offline:

- Tournament changes can continue locally.
- localStorage acts as the working/offline copy.
- Pending changes can be synchronized when connectivity returns.

## Cloud Data Model

The application uses a Club → Category structure.

```text
Club
│
├── Shared club settings
│
├── Category A
│   ├── Settings
│   ├── Players / Teams
│   ├── Groups
│   ├── Fixtures
│   ├── Results
│   └── Knockout data
│
├── Category B
│   └── ...
│
└── Category C
    └── ...
```

Supabase contains the main persistent records for:

- Clubs
- Club members
- Categories
- User profiles

The browser application communicates with Supabase through the Supabase client and the application's storage/synchronization layer.

## Saving

The **Save** operation saves the complete tournament workspace.

It does not save only the currently selected category.

For example, if the workspace contains:

```text
Category 1
Category 2
Category 3
Category 4
```

saving from Category 2 saves all four categories together.

This prevents inactive categories from being accidentally discarded.

## Reset

The application provides two reset levels.

### Reset Current Category

Clears tournament data for the currently selected category while preserving:

- Category settings
- Other categories
- Shared club information

### Reset Everything

Clears the complete workspace, including:

- Shared club information
- All categories
- Players
- Teams
- Groups
- Fixtures
- Results
- Rankings
- Knockout data

The next cloud save replaces the existing cloud snapshot with the cleared workspace.

## Export and Import

The application supports JSON export/import for backup and data transfer.

Export contains the **complete master workspace**, including all categories.

```text
Export
│
├── Shared club data
├── Category 1
├── Category 2
├── Category 3
└── Category 4
```

Import restores the complete workspace rather than importing only the active category.

After an import, the complete imported workspace is saved locally and synchronized with the cloud when cloud synchronization is available.

## Authentication

The cloud version requires an authenticated and approved user.

The application supports:

- Sign in
- Sign up request
- Password change
- Password reset
- User approval workflow
- Master administrator controls

New users are not automatically granted full access.

The master administrator can approve pending users.

## Supabase

The `supabase/` directory contains the database setup and policy definitions.

```text
supabase/
├── schema.sql
├── policies.sql
├── bootstrap_master_admin.sql
└── archive/
    └── historical migrations
```

### Important

The historical migration files are retained for reference and database migration history.

For a new Supabase installation, use the current schema and policy files rather than replaying historical migrations unnecessarily.

The live application does **not** load these SQL files from GitHub Pages. They are maintained in the repository for database setup, maintenance and reproducibility.

## Repository Structure

```text
badminton/
│
├── index.html
│
├── css/
│   └── app.css
│
├── js/
│   ├── app.js
│   ├── auth.js
│   ├── storage.js
│   ├── tournament.js
│   └── ui.js
│
└── supabase/
    ├── schema.sql
    ├── policies.sql
    ├── bootstrap_master_admin.sql
    └── archive/
        └── historical migrations
```

### Application files

| File | Purpose |
|---|---|
| `index.html` | Main application entry point |
| `css/app.css` | Application styling and responsive UI |
| `js/app.js` | Application startup and main application flow |
| `js/auth.js` | Authentication and user access |
| `js/storage.js` | Local/cloud persistence and synchronization |
| `js/tournament.js` | Tournament data and competition logic |
| `js/ui.js` | User interface and rendering |

## Hosting

The application can be hosted as a static website.

GitHub Pages is used for the live deployment.

No application server is required for the frontend.

Supabase provides the cloud database and authentication services.

## Development

The application is intentionally lightweight and browser-based.

For local development, the repository can be served using any simple HTTP server.

For example:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

A local HTTP server is recommended instead of opening `index.html` directly with `file://`, particularly when testing authentication and cloud functionality.

## Versioning

The application version is maintained consistently across the application release.

Current release:

**V6.1.6**

Version changes should be updated consistently before publishing a new release.

UI-only changes should not modify the tournament, persistence or Supabase architecture unless explicitly required.

## Data Safety

For important tournaments, use **Export JSON** as an additional backup.

The cloud database is the authoritative persistent store when online, while localStorage provides local/offline resilience.

Before making major database or application changes:

1. Export the current tournament data.
2. Verify the exported JSON exists.
3. Make the application/database changes.
4. Test cloud loading.
5. Test saving all categories.
6. Test import/export.
7. Test from another browser or device when appropriate.

## Security

Supabase credentials required by the browser application should only contain the public client configuration intended for frontend use.

**Never place Supabase service-role keys, database passwords, SMTP passwords, private API keys or other secrets in this repository.**

Supabase Row Level Security and database functions provide the server-side protection for cloud data.

## License

This project is licensed under the MIT License.

See [`LICENSE`](LICENSE) for the complete license text.

Copyright © 2026 Ruhul Amin.

## Author

**Ruhul Amin**

Badminton Tournament Manager was developed by Ruhul Amin.

Please retain the original developer attribution when modifying or redistributing the application.
