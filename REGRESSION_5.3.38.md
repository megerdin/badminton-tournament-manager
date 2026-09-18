# v5.3.38 Regression Correction

This build preserves the v5.3.37 tournament engine and UI. Changes are limited to cloud/auth reliability:

- Corrected cloud queue retry helpers (`queueUpdate`, `scheduleRetry`).
- Avoided awaiting Supabase calls inside `onAuthStateChange`.
- Matched master-admin approval RPC argument names to the deployed database signature (`p_user_id`, `p_status`).
- Aligned bundled Supabase SQL artifacts with the deployed database's text/check-constraint model.
- Version flag is V5.3.38.
