# End-to-End Private Beta Plan

Snapshot: 2026-10-31. This plan is based on the repository routes, product
catalog, release-gate documents, draft diffs, and the test evidence recorded in
those drafts. It is not an assertion that current production or staging matches
any draft, nor that a provider account or named MCP client has been certified.
The original working checkout has unrelated local changes; preserve them.
On 2026-10-31, `https://plusmy.ai` timed out in the in-app browser and could not
be loaded by the browsing service. A local DNS query returned A record
`192.64.119.240`, but a separate HTTPS connection attempt also timed out. These
are environment-specific observations, not proof of a global outage or its
cause; visual review and authorized hosting/ingress investigation remain open.

The goal is a web-first private beta where an invited workspace can safely
connect its business tools, authorize an AI client, use each advertised
capability, understand failures, and revoke access. The existing release gate
requires all 21 catalog providers and the four named client targets to be
certified. Narrowing that scope requires an explicit product decision, not a
relabeling of mock tests as certification. Mobile remains a scaffold.

## Site Inventory

| Surface | Existing source | End-to-end acceptance still required |
| --- | --- | --- |
| Home, login, auth callback, logout | Public entry and Supabase-backed sign-in | Signed-out and expired sessions recover safely; redirect targets cannot escape the app; login/logout work in staging and on mobile widths. |
| Join, onboarding, workspaces | Workspace selection, roles, invitations and member management | Invite expiry/replay, cross-workspace denial, role changes, last-owner safeguards, user removal and recovery are exercised with distinct real test identities. |
| Dashboard and platforms | Workspace summary, health and provider catalog | Counts and statuses match current authorized data, failures are visible, and catalog copy distinguishes implemented adapters from certified workflows. |
| Connections | Provider connect/callback, health, refresh, sync and revoke | Workspace/personal ownership, least-privilege scopes, concurrent refresh, reconnect/revoke, job retry, error recovery, audit and real provider behavior all pass. |
| Context | Assets, prompts, skills, bindings, search and embedding health | Private/shared isolation holds for database, server and MCP paths; large lists/counts are complete or explicitly paginated; ingestion, re-embedding, error states and account deletion are safe. |
| MCP setup, quickstart, clients, consent | Client onboarding, approvals, OAuth and Streamable HTTP | Each named client completes real discovery, consent, PKCE/token lifecycle, scoped tools/resources, reconnect and revocation on staging. Origin policy is explicitly approved. |
| Audit | Invocation/audit views, export and retention | Owner/admin/member isolation, pagination, complete attribution, redaction, export, retention and failure recovery are verified with safe test data. |
| APIs and background workers | App routes, Vault-backed secrets, queued refresh/sync, schedules and alerts | Mutations enforce tenant/role checks; workers fence stale claims; failures retry or dead-letter observably; staging schedule, alert and rollback work. |

A limited signed-out browser check used a local development server with fake
Supabase configuration and no running backend. `/connections` and `/platforms`
redirected to `/login` without a return path; `/context` showed an inline sign-in
message. At 390x844, the login form was below the initial viewport because the
header and navigation consumed most of the screen. Align sign-in recovery and
make the primary login action discoverable on small screens. Preserve invite
tokens safely rather than placing sensitive return URLs into third-party logs or
referrers. These observations do not establish deployed or authenticated UX.

The existing automated browser journeys and provider mocks are useful
regressions, but they do not establish real provider writes, named-client
compatibility, staging configuration or deployment correctness. See
[private-beta-gates.md](./private-beta-gates.md) and
[staging-acceptance.md](./staging-acceptance.md) for the detailed evidence
matrix. The provider catalog's term "live" means source availability, not a
private-beta certification.

## Dependency Order

1. **Freeze and reconcile the candidate.** Keep the original checkout's edits;
   review each draft against its stated base and preserve existing branch heads.
   PR #8 depends on #1; PR #11 depends on #2. Other current drafts are based on
   `dev`. CI files, migration checksums, build-plan notes and lockfiles overlap.
   Integrate only with explicit authorization, then rerun the combined audit,
   install, build, database and browser suites on the resulting exact commit.
2. **Close security and data-integrity gates.** Finish refresh-job claim and
   OAuth callback fencing, direct-table grant analysis, account deletion,
   historical metadata assessment, and staged migration/rollback ordering.
   Review the Origin allowlist and absence-of-Origin policy before configuring
   real clients. Obtain independent cross-provider review for consequential
   credential, tenancy and migration changes.
3. **Complete core operator journeys.** Make all list/count views accurate or
   paginated; show actionable unavailable/error states; finish invite/role,
   context, approval, audit and worker recovery cases with accessibility and
   responsive checks. Prevent an already dispatched operation from being
   represented as canceled unless that guarantee is actually enforceable.
4. **Certify providers in business priority order.** Use disposable tenants and
   scoped grants, after explicit operator approval. Order: CRM (HubSpot,
   Salesforce), finance (QuickBooks, Xero), support (ServiceNow, Zendesk),
   project management (Asana, monday.com, Linear, Jira), productivity
   (Airtable, Zoom), identity (Okta), documents (Google Workspace, Microsoft
   365), storage (Dropbox, Box), knowledge (Notion, Confluence), engineering
   (GitHub), then collaboration (Slack). For each provider test install,
   callback, identity, scopes, Vault storage, sync/refresh/reconnect/revoke,
   every advertised read and write, denied scopes, tenant isolation and
   corresponding audit. Record versions, test tenant, exact deployment and
   evidence; never use production writes as certification.
5. **Certify MCP clients.** For OpenAI, Anthropic, Gemini and Cursor, record
   exact client/version and staging deployment; exercise discovery, registration
   where supported, consent and PKCE, token rotation, allowed/denied scopes,
   resource read, one safe tool invocation, approval removal, revocation and
   reconnect. Verify browser Origin behavior through the real ingress and
   proxies; native requests without Origin need an explicit policy decision.
6. **Rehearse operations and release.** In separate staging, verify migrations
   and no-mixed-writer sequencing, Vault/worker configuration, scheduled due
   jobs, dead-letter alerts to a named operator, monitoring, backup/restore,
   incident runbook, credential rotation, canary and rollback. Re-run all
   release checks on the exact approved candidate. Invite beta users only after
   the gate owner signs off the evidence and no unresolved cross-tenant,
   credential-exposure or data-loss defect remains.

## Current Source Checkpoints

| Draft | Scope | What remains before acceptance |
| --- | --- | --- |
| [#1](https://github.com/StackAI-ai/plusmy.ai/pull/1) | MCP transport compatibility | Batch behavior follow-ups, exact named-client and ingress verification. |
| [#2](https://github.com/StackAI-ai/plusmy.ai/pull/2) | Personal context isolation | Account deletion, historical-data assessment, migration/rollback and broader acceptance. |
| [#3](https://github.com/StackAI-ai/plusmy.ai/pull/3) | Vault credential refresh fencing | Job claims, callback generation, grants, no-mixed-writer rollout, real concurrency/provider tests and cross-provider review. |
| [#4](https://github.com/StackAI-ai/plusmy.ai/pull/4), [#5](https://github.com/StackAI-ai/plusmy.ai/pull/5), [#6](https://github.com/StackAI-ai/plusmy.ai/pull/6), [#7](https://github.com/StackAI-ai/plusmy.ai/pull/7), [#9](https://github.com/StackAI-ai/plusmy.ai/pull/9), [#10](https://github.com/StackAI-ai/plusmy.ai/pull/10) | Scoped Next.js, shell-quote, nanoid, brace-expansion, tar and node-forge updates | Reconcile overlapping lockfiles and CI, rerun a combined audit, review compatibility and certify affected mobile/tooling paths. Tar can fail on previously accepted symlink chains and can leave partial output. |
| [#8](https://github.com/StackAI-ai/plusmy.ai/pull/8) | Proposed MCP Origin guard, stacked on #1 | User approval of trust policy, cross-provider review and named-client/ingress verification. |
| [#11](https://github.com/StackAI-ai/plusmy.ai/pull/11) | Actor-scoped context-health aggregate, stacked on #2 | Exact-head real Supabase CI and independent review; separate asset/prompt/skill list pagination remains. |

All are drafts, not integrated or deployed. The detailed, actionable inventory,
including evidence and ownership, is [PRIVATE_BETA_ISSUE_CHECKLIST.md](./PRIVATE_BETA_ISSUE_CHECKLIST.md).
Linear is the intended source of truth, but its requested MCP currently returns
`-32001 Unknown tool`; reconcile and deduplicate this inventory when restored.
No Linear issue is claimed complete based solely on this document.

## Release Evidence

Each check must identify the exact commit, environment, test actor/tenant,
time, observed result, and any skipped case. Keep credentials and private
customer content out of evidence. Distinguish (1) source review, (2) local
mocks/disposable tests, (3) exact-head CI, (4) authenticated staging behavior,
and (5) separately authorized production state. Green results at one layer do
not imply the next. Release owners should record unresolved risks and a
rollback point rather than infer readiness from the number of closed tasks.
