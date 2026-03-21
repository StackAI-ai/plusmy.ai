# plusmy.ai v1 build plan

## Summary
- Start from a fresh clone of `https://github.com/StackAI-ai/plusmy.ai` into `/Users/nickkulavic/Projects/plusmy.ai`.
- Build a greenfield Turborepo with `apps/web` and `apps/mobile`, shared domain packages, and a root `supabase/` workspace for SQL migrations and internal Edge Functions.
- Ship v1 around team workspaces, workspace + personal connections, Google Drive/Docs, Slack, and Notion, a vector-backed context library, and an OAuth-protected MCP server over Streamable HTTP.
- Use Supabase Auth for human users; `plusmy.ai` acts as the OAuth 2.1 authorization server and resource server for MCP clients.
- Store all provider access tokens, refresh tokens, and user API keys in Supabase Vault; application tables store only Vault secret UUIDs and metadata. Decryption is only via security-definer SQL functions or internal workers, never via client-facing tables.

## Implementation status
- Completed: repo scaffold, shared packages, initial Supabase schema, workspace/member/invite management, provider connection install/revoke flows, context asset/prompt/skill management, MCP discovery/token/resource/tool routes, dynamic OAuth client registration, and audit/tool invocation views.
- Completed: shared platform catalog now documents live provider support (Google Workspace, Slack, Notion), current MCP client targets (OpenAI, Anthropic, Gemini, Cursor), and reviewed next-wave integrations across documents, engineering, project management, CRM, support, storage, productivity, and identity surfaces directly in the repo and web app.
- Completed: persisted OAuth client approvals with workspace-scoped review and revoke controls, plus refresh-token invalidation when an approval is revoked.
- Completed: workspace-scoped context binding management for shared prompts and skills on the operator context surface.
- Completed: deeper MCP approval and audit visibility on operator pages with per-client tool invocation correlation, filtered audit views, and admin-only audit access.
- Completed: dashboard-level workspace summaries and health views now reflect live authorization, context binding, and connection state signals.
- In progress: continue product hardening across operator dashboards and activity views.
- Completed: binding-aware MCP/runtime resolution for bound prompt and skill resources, including bound-resource MCP listing/reading and runtime context threading into tool execution.
- Completed: background worker coverage for queued token refresh and connection sync jobs, including queued job state, retries, worker claiming, and operator-facing visibility on the connections surface.
- Completed: semantic context-asset injection into MCP resource reads and tool-call responses, including top-match workspace snippets threaded from `match_context_chunks`.
- In progress: continue operator-surface polish across non-dashboard pages (connections, MCP clients, audit) to surface degraded authorization and connection state inline.
- 2026-03-21 execution checkpoint: reviewed commit set `9615c8e..d46bad4` and created a fresh 30-item next-operator backlog in Linear (`NIC-12` through `NIC-42`) while closing implementation notes on completed items `NIC-5` through `NIC-10`.
- Completed: MCP approval remediation on the operator surface, including stale-vs-pending token exchange state, one-click self-reauthorization for approval owners, and operator-initiated renewal messaging on the OAuth consent screen.
- 2026-03-21 execution checkpoint: shipped `NIC-11` and `NIC-12`, validated the web app locally, and created follow-on operator backlog items `NIC-43` through `NIC-45` for local origin handling, member identity labels, and approval-health filtering.
- 2026-03-21 execution checkpoint: migrated the web app onto actual shadcn-style UI primitives in `packages/ui`, updated theme tokens/Tailwind wiring, and refactored the main operator surfaces to use shared `Card`, `Button`, `Input`, `Select`, and layout composition instead of ad hoc wrappers.

## Next execution slice (2026-03-21)
- Prioritize adjacent MCP client follow-up work in `NIC-45`, `NIC-44`, and `NIC-43` so approval remediation is easier to operate locally and across multi-user workspaces.
- Continue with operator drill-down/pagination work in `NIC-13` and `NIC-14` once the approval list becomes easier to filter and read.
- Return to reliability hardening in `NIC-16` and `NIC-17` after the current operator-surface remediation loop is complete.
- Use the broader platform catalog to decide the next adapter scaffolds; the most obvious candidates are Microsoft 365, GitHub, Linear, Jira, Confluence, HubSpot, Salesforce, Zendesk, Dropbox, Airtable, Box, Asana, monday.com, ServiceNow, Zoom, and Okta.

## Implementation changes
1. Fresh repo bootstrap: replace the current empty workspace with a clean clone of the GitHub repo, set the default branch as the base, and treat the first commit after clone as the canonical scaffold baseline for all subsequent work.
2. Repo foundation: initialize Turborepo with `apps/web` (Next.js App Router), `apps/mobile` (Expo scaffold only), `packages/ui`, `packages/config`, `packages/contracts`, `packages/supabase`, `packages/integrations`, `packages/mcp`, and `packages/core`; keep `supabase/` at the repo root for migrations, seeds, generated types, and internal Edge Functions.
3. App auth and tenancy: model `workspaces`, `workspace_members`, `workspace_invites`, and `profiles`; roles are `owner`, `admin`, `member`; all product data carries `workspace_id`, with optional `owner_user_id` for personal-scoped connections and contexts.
4. Secrets and connections: create `providers`, `provider_scopes`, `connections`, `connection_grants`, `connection_credentials`, and `connection_sync_jobs`; `connection_credentials` stores only `vault_secret_id` references for access tokens, refresh tokens, and API keys, plus expiry/version metadata; direct `SELECT` on decrypted secrets is forbidden outside internal functions.
5. Context engine: create `context_assets`, `context_asset_chunks`, `prompt_templates`, `skill_definitions`, and `context_bindings`; store embeddings in `extensions.vector(1536)` initially and expose a single `match_context_chunks(workspace_id, query_embedding, limit, filters)` RPC that applies workspace filtering before similarity ranking.
6. Audit and rate control: create append-only `audit_logs`, `tool_invocations`, and `rate_limit_buckets`; implement `consume_rate_limit(workspace_id, subject, action, window_seconds, limit)` as a Postgres RPC.
7. Integration abstraction layer: define a provider registry in `packages/integrations` where each adapter declares OAuth config, supported scopes, credential shape, refresh strategy, connection validator, sync jobs, and MCP tool/resource factories; v1 adapters are Google Drive/Docs read/search, Slack channel read/post, and Notion search/read/create page.
8. OAuth token lifecycle: on every tool call, load connection metadata, resolve secrets through a definer function, and use the token if expiry is safely in the future; if expiry is near or the provider returns `401` or `invalid_grant`, acquire an advisory lock on the connection, refresh once, persist the new token set back into Vault, update expiry/version, and continue; if refresh fails, mark the connection `reauth_required`, archive the failure reason, and enqueue owner/admin notification.
9. MCP server and client auth: expose `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/authorize`, `/token`, `/register`, and `/mcp`; implement OAuth 2.1 authorization code + PKCE for human consent and support dynamic client registration for modern MCP clients; issue short-lived JWT access tokens with audience bound to the MCP resource server and store hashed refresh tokens in Postgres.
10. MCP tool resolution: create a per-request auth context from the MCP bearer token, map it to workspace membership and optional user scope, list only tools/resources allowed by workspace plan, connection state, and granted scopes, and inject top-k context assets into tool/resource responses via `match_context_chunks`.
11. Web product surface: ship onboarding, workspace switcher, member management, connection setup/callback pages, connection health/status, context library, prompt/skill editor, OAuth client approvals, audit log viewer, and MCP connection instructions; use the shared `packages/ui` shadcn-style primitive layer for product UI composition; keep all write paths on Node runtime routes, not Edge.
12. Mobile scaffold: create Expo auth/session wiring, workspace switcher, read-only connection status, and context browsing using shared contracts and Supabase clients; defer mobile OAuth setup flows and MCP administration UI until web is stable.
13. Background processing: keep user-facing app and MCP endpoints on Vercel; use internal Supabase Edge Functions only for queue consumers, scheduled syncs, and rate-limit/audit maintenance.

## Public APIs and interfaces
- `packages/contracts`: `WorkspaceRole`, `ConnectionScope`, `ConnectionStatus`, `ProviderId`, `ToolCapability`, `ContextAssetType`, `AuditAction`, and OAuth/MCP DTOs shared by web and mobile.
- `packages/integrations`: `IntegrationDefinition`, `ConnectionDescriptor`, `CredentialResolver`, `TokenRefresher`, `ToolFactory`, `ResourceFactory`, `SyncJobHandler`, and `WebhookHandler`.
- `packages/mcp`: `createMcpServer(authContext)`, `resolveAvailableTools(authContext)`, `resolveAvailableResources(authContext)`, and `executeToolCall(authContext, toolName, input)`.
- SQL/RPC surface: `app.current_workspace_ids()`, `app.store_secret(...)`, `app.resolve_secret(...)`, `app.enqueue_token_refresh(connection_id, reason)`, `app.match_context_chunks(...)`, and `app.consume_rate_limit(...)`.
- OAuth surface: `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource`, `POST /register`, `GET|POST /authorize`, `POST /token`, and `ALL /mcp` over Streamable HTTP.

## Test plan
- Fresh clone/bootstrap: repo installs cleanly from the cloned baseline, shared package resolution works, and web/mobile/supabase workspaces all link correctly.
- Workspace/RLS: members can only see their own workspaces; owners/admins can manage integrations; members cannot resolve or mutate credentials directly.
- Vault/secrets: plaintext provider credentials never land in application tables, logs, analytics events, or client responses.
- OAuth providers: install, callback, token refresh, revoked refresh token, missing scopes, duplicate install, personal vs workspace ownership, and reauth-required recovery all behave deterministically.
- MCP OAuth: metadata discovery, dynamic client registration, auth code + PKCE, consent approval, refresh token rotation, invalid audience rejection, expired token rejection, and tool visibility per workspace/user scope all pass against at least one standard MCP client.
- Tool execution: Google/Slack/Notion tools respect provider scopes, connection state, rate limits, and audit logging; near-expiry tokens refresh once under concurrency without double-refreshing.
- Context engine: chunk ingestion, re-embedding on edit, filtered semantic retrieval, workspace isolation, and prompt/skill composition into MCP resources behave correctly.

## Assumptions and defaults
- The first execution step is a fresh clone into `/Users/nickkulavic/Projects/plusmy.ai`; no local work needs to be preserved from the current empty directory.
- v1 is web-first with an Expo scaffold, not mobile feature parity.
- Billing is deferred; the schema can include `plan` and `entitlement` fields but Stripe and hard paywalls are not part of the first build.
- Google v1 means Drive/Docs search and read, not broad Gmail or admin scopes; Slack v1 includes read channels/history and post message; Notion v1 includes search, read, and create page.
- Embeddings start with a 1536-dimension provider behind an adapter interface so the storage contract stays stable while the embedding vendor can change later.
- `plusmy.ai` is the MCP OAuth authorization server for client access, while third-party provider OAuth remains separate and is mediated by the integration adapters.
