# Staging acceptance checklist

This checklist records deployed evidence, not local simulation. Use a separate
Vercel project, Supabase project, and approved disposable provider accounts.
Do not paste secrets, OAuth codes, or customer data into this file or Linear.

## Provisioning gate

- [ ] Link this checkout to the intended Vercel staging project and record its
  project name, deployment URL, and commit SHA.
- [ ] Link to the intended Supabase staging project and record its project ref,
  region, migration version, and Edge Function deployment version.
- [ ] Configure the web app and Edge Function with the same high-entropy
  `WORKER_SHARED_SECRET`; configure `APP_URL` in the Edge Function and the
  `plusmy_worker_project_url` and `plusmy_worker_shared_secret` Vault entries.
  Follow [operator-runbook.md](./operator-runbook.md) for rotation and storage.
- [ ] Verify auth redirect URLs, OAuth callback URLs, and each provider's
  requested scopes against the staging deployment. Keep production accounts
  and credentials out of staging.

## Scheduled-worker acceptance

1. Verify `plusmy-connection-worker` is scheduled every minute and its recent
   `cron.job_run_details` entries succeed. A cron success alone is insufficient.
2. Confirm the corresponding `net._http_response` has HTTP 200 and the Edge
   Function log shows the authorized call. A request without the shared secret
   must return 403.
3. In an approved disposable connection, queue a due sync or refresh job.
   Record its job ID, initial state, final `succeeded` state, audit events, and
   timestamps. Verify the operation against the provider account, not only the
   job response.
4. Induce a safe disposable failure, confirm retry/dead-letter visibility and
   alert delivery to the named operator, then restore the connection. Record
   alert destination and acknowledgement time without storing credentials.

## Release gate

- [ ] Complete every row in [private-beta-gates.md](./private-beta-gates.md)
  with linked evidence from disposable tenants. Mock contracts and local
  browser tests are regression evidence only.
- [ ] Verify OpenAI, Anthropic, Gemini, and Cursor as named MCP clients on
  staging, including consent, allowed tool execution, revocation, and audit.
- [ ] Rehearse a rollback to the previous web deployment and document how to
  halt/restart the worker without losing queued jobs; verify recovery.
- [ ] Record the final deployment SHA, test date, responsible operator, evidence
  links, and any unresolved limitations before issuing invitations.

## 2026-09-28 inventory

Read-only CLI inspection in the current account found no `.vercel` link in
this checkout, no plusmy.ai project in the visible `stackai` Vercel scope, and
no plusmy.ai project in the accessible Supabase project list. This is an
inventory of current access, not proof that no staging environment exists in
another account or organization. Provisioning/linkage and disposable provider
tenants are prerequisites for the deployed checks above.
