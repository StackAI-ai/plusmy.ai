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
- The browser E2E suite runs with `pnpm --filter @plusmy/web e2e` after local Supabase and the web app are up on port 3009. It requires the seeded owner, Supabase Mailpit, and `E2E_MAILPIT_URL` in a disposable `apps/web/.env.local`; `node scripts/local-supabase-env.mjs --write-env` generates that file for CI. Back up and restore any existing ignored env file when running locally.
- MCP smoke tokens resolve through the seeded local-only `plusmy-smoke-fixture` client and active owner approval. A signed JWT by itself is no longer sufficient: `/mcp` rechecks workspace membership, active approval, and approved scopes. Do not use the fixture as evidence for a named client or real provider.
- MCP approval renewal must start in the client with a fresh S256 PKCE challenge; the operator page links to reconnect instructions rather than minting a code without a client-held verifier. Code and refresh-token exchanges are single-use. A narrowed or revoked approval invalidates broader access immediately at `/mcp` and blocks its refresh tokens.
- GitHub Actions prefetches the exact Supabase CLI 2.83.0 image tags from Supabase's GHCR packages and retags them locally for the CLI. This avoids Public ECR pull-rate failures observed before tests in CI attempts 1 and 2 of run `36410909236`. Update the pinned tags when the CLI lockfile version changes.

## 2026-09-28 validation checkpoint
- Corrected the initial bootstrap to install `supabase_vault` and create the `pgmq` schema before installing that extension; a fresh local PG17 stack applied all 16 migrations and the seed.
- Added a forward security migration for non-recursive workspace membership checks, service-only SQL functions, and the stale job-claim RPC overload. The 32 pgTAP security assertions pass.
- With a disposable local env file, strict MCP compatibility and stress checks pass against the seeded database. The local file was removed and the original ignored `.env.local` restored after testing.
- Mocked finance contracts and all nine typecheck targets pass. Real provider account certification and authenticated browser journeys remain pending.
- Added Chromium browser coverage for signed-out isolation and a seeded owner journey through a real Mailpit magic link, Supabase callback, workspace API, and six operator pages. Both E2E tests pass locally. The run exposed and fixed browser public-env inlining and nullable fields in the local Auth seed; CI now runs this browser journey and retains traces on failure.
- That initial journey was not admin/member role coverage, a provider-account certification, or evidence of connection/MCP mutation paths.
- The next browser slice added seeded admin/member/outsider identities and a second isolated workspace. The four-test suite now verifies owner role changes, admin invite create/revoke with owner-protection denials, member mutation/audit/export denials, and cross-workspace API isolation. It also fixed `listWorkspaceMembers`: the prior PostgREST embed used a nonexistent direct profile relationship and silently returned an empty list on error. Member and profile reads are now explicit, with errors propagated.
- Admin/member role coverage is still partial; at that checkpoint, invite acceptance and the connection, context, MCP, and retention journeys remained unverified.
- Invite acceptance now runs as one service-only SQL transaction: it row-locks the invite, matches the current user's database email, creates membership, and consumes the token. The browser suite verifies wrong-user denial, the invited user's `/join` flow, and replay rejection; pgTAP checks RPC privileges and membership/token updates. Successful acceptance uses a full redirect that removes the invite token from browser history, and shared navigation carries only the workspace parameter.
- The context browser journey now creates workspace-shared assets, prompts, skills, and a binding, then verifies member write denials, personal prompt ownership/visibility, workspace isolation, and binding removal. Core service-role writes independently enforce shared owner/admin role or personal record ownership; members see only the personal ingest scope. The binding editor uses the live provider registry and tools from workspace connections. Connection lifecycle, MCP consent/tool execution, and audit retention remain open.
- The current nine-test browser suite also covers the synthetic connection lifecycle, MCP consent/code/refresh/resource/scope/revocation flow, and audit export/retention with disposable rows. It still does not exercise a real provider tool, named MCP client, or staging deployment. pgTAP now has 46 assertions including service-only refresh rotation and replay/expiry checks.

## Provider and worker failure states

### Scheduled connection worker
- The `plusmy-connection-worker` pg_cron job dispatches once per minute through pg_net to the `token-refresh-worker` Edge Function. The Edge Function requires `x-plusmy-worker-secret` even though its platform JWT check is disabled for cron calls; it forwards authorized work to the Node connection-job route.
- For each staging or production Supabase project, deploy the Edge Function and configure `APP_URL` plus `WORKER_SHARED_SECRET` as Edge Function secrets. The web deployment must use the same high-entropy `WORKER_SHARED_SECRET`.
- In that project's Supabase Vault, create `plusmy_worker_project_url` with its HTTPS Supabase project URL and `plusmy_worker_shared_secret` with that shared secret. Do not put either value in a migration, `cron.job.command`, an app table, or an issue comment. The cron dispatcher returns without making a request until both Vault entries exist.
- Confirm a one-minute job entry in `cron.job`, successful executions in `cron.job_run_details`, HTTP responses in `net._http_response`, and a queued connection job moving to `succeeded`. A pg_cron success only proves dispatch SQL ran; inspect the HTTP response and job state before claiming worker acceptance.
- Rotate the Edge, web, and Vault copies of the shared secret together. To avoid failed dispatches during rotation, pause the cron job, accept a brief worker interruption, then resume it after an authenticated invocation succeeds.
- Configure `OPERATOR_ALERT_WEBHOOK_URL` on the web deployment with an HTTPS endpoint owned by the beta operator. It receives a JSON `connection_job.dead_lettered` event containing workspace, connection, provider, job IDs, job type, attempts, and an audit link, but no provider credentials or raw provider error. Keep any webhook credential in the server-only environment, not in an application table or issue. Without this setting the dashboard still shows dead letters, but no outbound alert is sent and `alerted_at` remains null.
- The worker claims up to three unalerted dead letters per invocation. A 2xx webhook response marks `alerted_at` and records `connection_job.alert_delivered`; non-2xx/timeout releases the claim, records `connection_job.alert_failed`, and retries at the next dispatch. Crashed claims expire after five minutes. Delivery is at least once if a webhook succeeds but the delivery acknowledgment cannot be saved; the `x-plusmy-alert-id` header carries the stable job ID for receiver-side deduplication.
- The alert-delivery migration clears legacy `alerted_at` values on dead-letter jobs because the old worker set them without sending a notification. Inspect the pending dead-letter count before enabling the webhook in an existing environment; historical incidents may be delivered in batches of three per worker invocation.
- In staging, induce a safe dead-letter on disposable data, confirm the named operator receives one alert and can open the audit link, then verify `alerted_at` and the delivery audit record. Separately reject one webhook request and confirm retry. Dashboard visibility alone does not satisfy alert-delivery acceptance.

| Signal | Where it shows up | Typical cause | Operator action |
| --- | --- | --- | --- |
| `pending` connection | Connections page, dashboard counts | OAuth install started but callback not completed | Re-run the provider connect flow and confirm callback/env settings. |
| `reauth_required` connection | Connections page badges and health filters | Refresh token revoked, scopes removed, or provider returned `invalid_grant`/`401` | Reauthorize the provider install, then queue a fresh sync or token refresh. |
| `stale` connection health | Connections page health filters | Token refresh schedule is overdue or the last validation is old | Inspect queued jobs and trigger a manual refresh if provider credentials are still valid. |
| `failed` connection job | Audit and job lists | A processing attempt failed but still has retry budget left | Check the latest error and allow the worker retry window to continue. |
| `dead_letter` connection job | Dashboard and connections operator alerts | Retry budget exhausted for a sync or refresh job | Fix the provider-side issue, inspect audit history, then queue a brand-new job after remediation. |
| Revoked approval | MCP clients page and approval health reasons | Approval owner revoked access or workspace access was removed | Have a current workspace member restart authorization from the MCP client with fresh PKCE. |
| Scope drift | MCP approvals and connection health | Provider token scopes no longer satisfy MCP tool requirements | Reinstall the provider with the required scopes before retrying MCP calls. |

## Dead-letter response checklist
1. Open the audit trail for the dead-lettered job and capture the last provider error.
2. Confirm whether the issue is auth-related (`401`, revoked refresh token, missing scope) or provider/runtime-related (rate limit, outage, invalid payload).
3. If auth-related, reconnect the provider first so the next job does not burn a second retry budget.
4. If provider/runtime-related, fix the upstream configuration or payload source before requeueing.
5. Queue a fresh sync from the connections surface after remediation and confirm the next run reaches `succeeded`.
