# AGENTS.md

## Scope
These instructions apply to `supabase/`.

## Database rules
- Treat migrations as the source of truth for schema changes.
- Preserve RLS, workspace isolation, and Vault-backed secret indirection.
- Never replace Vault references with plaintext credentials in application tables.
- Keep helper functions compatible with the server-side access patterns in `packages/core`.

## Background work
- Use Edge Functions here for internal workers and queue consumers, not for the main web product surface.
- Keep token refresh, rate limiting, and audit maintenance aligned with `docs/BUILD_PLAN.md`.
