# Private-beta release gates

The catalog lists 21 live providers. "Live" means an adapter is available in the product; it does not mean the provider has passed private-beta end-to-end certification. All rows below are pending until linked evidence from an approved disposable tenant is recorded. Mocked provider contracts are regression checks, not certification.

## Provider certification

For each provider, record the test tenant and date, commit and deployment, actor/workspace, and evidence links for:

1. OAuth install/callback, account identity, granted scopes, Vault-only credentials, and connection health.
2. Scheduled and forced refresh, sync, reconnect after revoked credentials, and connection revocation.
3. One advertised read capability and every advertised write capability against approved disposable data; verify permission denial and scope-drift behavior.
4. MCP tool visibility and execution under the right workspace and role, with matching audit records and no cross-workspace access.

Do not mark a row certified when an advertised operation is skipped, the provider test account is unavailable, or an error is masked by a mock. Add provider-specific limitations and remediation to the evidence link before sign-off.

| Priority | Provider | ID | Status | Evidence |
| --- | --- | --- | --- | --- |
| CRM | HubSpot | `hubspot` | Pending | |
| CRM | Salesforce | `salesforce` | Pending | |
| Finance | QuickBooks Online | `quickbooks` | Pending | |
| Finance | Xero | `xero` | Pending | |
| Support | ServiceNow | `servicenow` | Pending | |
| Support | Zendesk | `zendesk` | Pending | |
| Project management | Asana | `asana` | Pending | |
| Project management | monday.com | `monday` | Pending | |
| Project management | Linear | `linear` | Pending | |
| Project management | Jira | `jira` | Pending | |
| Productivity | Airtable | `airtable` | Pending | |
| Productivity | Zoom | `zoom` | Pending | |
| Identity | Okta | `okta` | Pending | |
| Documents | Google Workspace | `google` | Pending | |
| Documents | Microsoft 365 | `microsoft365` | Pending | |
| Storage | Dropbox | `dropbox` | Pending | |
| Storage | Box | `box` | Pending | |
| Knowledge | Notion | `notion` | Pending | |
| Knowledge | Confluence | `confluence` | Pending | |
| Engineering | GitHub | `github` | Pending | |
| Collaboration | Slack | `slack` | Pending | |

## Cross-product gates

- Partial automated evidence: local Chromium E2E passes signed-out dashboard isolation; owner/admin/member sign-in via Mailpit; owner role changes; admin member-invite create/revoke and owner-protection denials; wrong-user invite denial, invited-user acceptance, and replay rejection; member mutation/audit/export denials; isolation from a second workspace; owner access to workspaces/connections/context/MCP-clients/audit/onboarding pages; shared asset/prompt/skill/binding creation, member shared-write denial, personal prompt ownership and visibility, binding removal, and provider binding choices from the live registry. A disposable connection fixture also verifies personal-vs-workspace visibility and mutation authorization, malformed body rejection, sync queue and revoke audit records, revoked-operation denial, and OAuth callback rejection for a signed-out or mismatched user before provider exchange. It does not exercise a real provider account, token refresh success, MCP consent/tool execution, or audit-retention journeys.
- Authenticated browser journeys pass for owner, admin, member, and signed-out users: login, workspace/invite/role management, connection lifecycle, context/prompt/skill binding, MCP consent/revocation, tool execution, and audit/export/retention.
- Local CI starts Supabase, applies migrations and seed, and passes typecheck, doctor, pgTAP, provider contracts, strict MCP compatibility/stress, and browser E2E checks. No check passes by skipping authentication or backend setup.
- Partial scheduled-worker evidence: the migration registers a one-minute pg_cron/pg_net dispatcher; local Edge calls without its shared secret returned 403, while a direct authorized call and both manual and scheduled local dispatches returned HTTP 200. The 41-assertion pgTAP suite and CI Edge auth smoke check pass. Staging acceptance still requires Vault/Edge/web secret provisioning, a due job reaching `succeeded`, and alerting on failures.
- Staging uses separate Vercel/Supabase environments, real disposable provider tenants, a running scheduled connection worker, alerting, and a rehearsed rollback. No production provider writes are part of certification.
- Four advertised MCP clients (OpenAI, Anthropic, Gemini, Cursor) pass connection and authorization checks against staging.
- No open cross-workspace access, secret exposure, or data-loss defect remains. All 21 provider rows are certified before private-beta invitations.
