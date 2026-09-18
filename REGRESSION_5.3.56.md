# Regression 5.3.56

## Scope
- Base package: v5.3.55
- Release: v5.3.56
- Existing tournament engine and cloud data model retained.

## Fixes / changes
- Sign-in gate redesigned for a cleaner mobile-first layout.
- Sign-in view now presents Email address, Password, Sign in, Sign up, and Forgot password in the requested order.
- Sign-up mode retains Name, Club name, City, Email address, Password and Sign up.
- Sign-in / Sign-up mode switching is explicitly wired and tested with a lightweight DOM harness.
- Added a User Profile section at the bottom of the application showing name, club, city, email, account status and role.
- Export Fixtures PDF typography swapped as requested:
  - Club name: 16pt -> 18pt
  - Group A — Group Fixtures: 18pt -> 16pt
- Removed the PDF footer text: "Blank cells are provided for fixture entries."
- Added an application-level 30-minute inactivity session timeout.
  - Activity is tracked across pointer, keyboard, touch and scroll interaction.
  - Visibility changes re-check inactivity when the app becomes visible again.
  - Inactivity expiry signs out the current browser session locally and requires sign-in again.
  - The Supabase server-side inactivity-timeout setting is a Pro+ feature, so this release implements the policy in the client rather than changing a server setting.
- Explicit sign-out now uses the current-session (`local`) scope rather than revoking other active sessions.
- Version flag consistency:
  - `index.html`: exactly one `#appVersion`, V5.3.56
  - `js/tournament.js`: `APP_VERSION = '5.3.56'`

## Verification performed
- All JavaScript files pass `node --check`.
- No duplicate HTML IDs found.
- Exactly one `#appVersion` element found.
- Version flag and internal APP_VERSION both report V5.3.56.
- PDF requested footer text no longer exists in `js/ui.js`.
- PDF font-size swap verified in `drawGroupFixturePdfPage()`.
- Auth mode switching verified with a DOM test harness.
- 30-minute inactivity calculation and monitor start/stop verified with a DOM test harness.
- ZIP integrity checked after packaging.
