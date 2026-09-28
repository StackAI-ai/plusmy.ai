# Operator runbook

Private-beta release criteria and per-provider evidence are tracked in [private-beta-gates.md](./private-beta-gates.md).

## Bootstrap checks
- Run `npm run doctor` from the repo root before local work when you are unsure about dependencies, env setup, or bundled Supabase tooling.
- Local Supabase needs its configured ports free. If another project owns `54321`-`54324`, do not stop that project; use an isolated port configuration for this checkout's validation, then restore `supabase/config.toml` after stopping plusmy.ai's containers.
- The doctor currently verifies:
  - root and `apps/web` dependencies are installed
  - `apps/web/.env.local` exists with required product secrets
  - bundled or global Supabase CLI is available
  - local `APP_URL` preference matches `http://localhost:3009`
  - Supabase config and migrations are present

## MCP smoke checks
- `npm run mcp:compat` and `npm run mcp:stress` will auto-mint a short-lived MCP bearer token when `MCP_JWT_SECRET` is available (or present in `apps/web/.env.local`).
- Set `MCP_STRESS_TOKEN` or `MCP_COMPAT_TOKEN` to override the fixture token for targeted debugging.
- The compatibility check now requires a bearer token, successful dynamic client registration, an unauthenticated consent challenge for that registered client, invalid-code rejection, and authenticated MCP list responses. A skipped auth step is a failed check.
- CI starts local Supabase, writes a throwaway `apps/web/.env.local` from its local status, and runs pgTAP, finance contracts, and MCP smoke checks. Provider contracts are mocked; they do not certify a real provider account.
- For local checks without changing your `.env.local`, run `node scripts/local-supabase-env.mjs -- npm run dev` after Supabase starts. The launcher supplies short-lived local role JWTs; `--write-env` is reserved for disposable CI environments because it replaces the app env file.

## 2026-09-28 validation checkpoint
- Corrected the initial bootstrap to install `supabase_vault` and create the `pgmq` schema before installing that extension; a fresh local PG17 stack applied all 16 migrations and the seed.
- Added a forward security migration for non-recursive workspace membership checks, service-only SQL functions, and the stale job-claim RPC overload. The 32 pgTAP security assertions pass.
- With a disposable local env file, strict MCP compatibility and stress checks pass against the seeded database. The local file was removed and the original ignored `.env.local` restored after testing.
- Mocked finance contracts and all nine typecheck targets pass. Real provider account certification and authenticated browser journeys remain pending.

## Provider and worker failure states

| Signal | Where it shows up | Typical cause | Operator action |
| --- | --- | --- | --- |
| `pending` connection | Connections page, dashboard counts | OAuth install started but callback not completed | Re-run the provider connect flow and confirm callback/env settings. |
| `reauth_required` connection | Connections page badges and health filters | Refresh token revoked, scopes removed, or provider returned `invalid_grant`/`401` | Reauthorize the provider install, then queue a fresh sync or token refresh. |
| `stale` connection health | Connections page health filters | Token refresh schedule is overdue or the last validation is old | Inspect queued jobs and trigger a manual refresh if provider credentials are still valid. |
| `failed` connection job | Audit and job lists | A processing attempt failed but still has retry budget left | Check the latest error and allow the worker retry window to continue. |
| `dead_letter` connection job | Dashboard and connections operator alerts | Retry budget exhausted for a sync or refresh job | Fix the provider-side issue, inspect audit history, then queue a brand-new job after remediation. |
| Revoked approval | MCP clients page and approval health reasons | Approval owner revoked access or workspace access was removed | Have a current workspace member reauthorize the client. |
| Scope drift | MCP approvals and connection health | Provider token scopes no longer satisfy MCP tool requirements | Reinstall the provider with the required scopes before retrying MCP calls. |

## Dead-letter response checklist
1. Open the audit trail for the dead-lettered job and capture the last provider error.
2. Confirm whether the issue is auth-related (`401`, revoked refresh token, missing scope) or provider/runtime-related (rate limit, outage, invalid payload).
3. If auth-related, reconnect the provider first so the next job does not burn a second retry budget.
4. If provider/runtime-related, fix the upstream configuration or payload source before requeueing.
5. Queue a fresh sync from the connections surface after remediation and confirm the next run reaches `succeeded`.
