# Operator runbook

## Bootstrap checks
- Run `npm run doctor` from the repo root before local work when you are unsure about dependencies, env setup, or bundled Supabase tooling.
- The doctor currently verifies:
  - root and `apps/web` dependencies are installed
  - `apps/web/.env.local` exists with required product secrets
  - bundled or global Supabase CLI is available
  - local `APP_URL` preference matches `http://localhost:3009`
  - Supabase config and migrations are present

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
