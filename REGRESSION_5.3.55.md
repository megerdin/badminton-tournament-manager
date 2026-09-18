# Badminton Tournament Manager — v5.3.55 UI refinement

## Authentication registration details

- Sign-in mode shows only email address and password.
- Sign-up mode shows name, club name, city, email and password.
- Sign-up sends name, club name and city as Supabase user metadata.
- `profiles` stores `display_name`, `club_name` and `city` for approval review.
- Master-admin pending signup list shows name plus club, city and email.
- Existing authentication, approval, cloud sync and tournament functionality is otherwise unchanged.

## Database

Applied migration `add_signup_request_details` to add `club_name` and `city` to `public.profiles`.
Updated `public.handle_new_user()` to capture signup metadata.

## Verification

- JavaScript syntax checks passed for all application JS files.
- Live Supabase schema/function verification passed.
- Version marker updated to v5.3.55.
