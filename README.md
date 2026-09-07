# Badminton Tournament Manager

A self-contained, browser-based badminton tournament management application.

## Version

**4.0.0**

## Live application

GitHub Pages:

https://megerdin.github.io/badminton-tournament-manager/

## Overview

Badminton Tournament Manager is designed to run directly in a modern web browser without a server-side application or database.

Tournament data is stored locally in the browser and can be exported/imported as JSON for backup and transfer.

## Main capabilities

- Player and team entry
- Player Pool team generation
- Group creation and team allocation
- Group fixture generation
- Match result and walkover recording
- Group standings and qualification
- Tournament ranking
- Pre-Knockout stage
- Main Knockout draw and progression
- Third-place playoff
- Podium/results
- Local browser persistence
- JSON export/import
- Runtime calculation indexes and caches
- Controlled downstream rendering and stage-validity detection

## Architecture

The application is a single self-contained HTML file.

The architecture distinguishes between:

- **Authoritative state** — teams, players, groups, fixtures and recorded results.
- **Derived state** — standings, qualification, knockout participants and display calculations.
- **Controlled refresh flows** — targeted rendering after result and structural changes, avoiding unnecessary full-page recomputation where possible.
- **Stage validity tracking** — generated competition stages retain build information so structural changes can be detected before rebuilding.

## Data model

Tournament data is stored in browser `localStorage`. Use the built-in JSON export/import functions to back up or move tournament state between browsers or devices.

## License

MIT License.

Original developer: **Ruhul Amin**.

Please retain the original developer attribution when modifying or redistributing this application.
