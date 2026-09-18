# Badminton Tournament Manager — v5.3.51

Major lifecycle regression checkpoint.

## Scope
- Preserves the v5.3.7 tournament engine and existing tournament functionality.
- Corrects the application version flag to 5.3.51.
- Hardens Supabase authentication startup against duplicate profile loading when the initial session event overlaps the explicit getSession/profile path.
- Keeps local-first persistence, pending cloud queue protection, and explicit conflict recovery unchanged.

## Verification
- JavaScript syntax checks: PASS
- Package structure: PASS
- ZIP integrity: PASS
- Version consistency: PASS
- Existing tournament engine source retained: PASS
- No browser runtime PASS claim; prior headless runtime environment remains unreliable.
