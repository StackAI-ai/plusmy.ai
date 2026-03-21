# AGENTS.md

## Scope
These instructions apply to the entire repository.

## Source of truth
- Read `docs/BUILD_PLAN.md` before making substantial architectural changes.
- Keep implementation aligned with the Vercel + Supabase web-first plan unless the user explicitly changes direction.
- If code and the plan diverge, update the plan file in the same change set.

## Working style
- Build production-grade SaaS software in a focused, concise manner.
- Commit as you go. Prefer small, coherent checkpoints instead of large uncommitted batches.
- Do not leave partially-written files behind between commits.
- Prefer incremental changes that preserve the existing workspace-aware product surface.

## Repository conventions
- `apps/web` is the primary product surface.
- `apps/mobile` is a scaffold until mobile parity is explicitly prioritized.
- Shared contracts and logic live in `packages/*`.
- Database schema, RLS, Vault functions, queues, and Edge workers live under `supabase/`.
- Workspace context is selected via the `workspace` query parameter across operator pages.

## Security requirements
- Never store provider tokens or API keys in plaintext application tables.
- Keep Vault-backed secret access behind server-only helpers or security-definer SQL functions.
- Preserve workspace isolation and role-based checks on every route that mutates tenant state.

## Validation posture
- Run only the minimum validation needed for the task at hand.
- If you update architecture, flows, or conventions, make the corresponding doc updates in this repo.
