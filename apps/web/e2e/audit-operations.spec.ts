import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const owner = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@plusmy.local', role: 'owner' };
const admin = { id: '22222222-2222-2222-2222-222222222222', email: 'admin@plusmy.local', role: 'admin' };
const member = { id: '33333333-3333-3333-3333-333333333333', email: 'member@plusmy.local', role: 'member' };

function localEnvValue(key: string) {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const value = envFile.split('\n').find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
  if (!value) throw new Error(`${key} is required for local E2E.`);
  return value;
}

function localServiceClient() {
  return createClient(localEnvValue('NEXT_PUBLIC_SUPABASE_URL'), localEnvValue('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false }
  });
}

async function latestEmail(request: APIRequestContext, email: string) {
  const url = new URL('/view/latest.txt', localEnvValue('E2E_MAILPIT_URL'));
  url.searchParams.set('query', `to:${email}`);
  const response = await request.get(url.toString());
  return response.ok() ? await response.text() : '';
}

async function signIn(page: Page, request: APIRequestContext, email: string) {
  const priorEmail = await latestEmail(request, email);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByText('Magic link sent. Check your inbox.')).toBeVisible();

  let link = '';
  await expect.poll(async () => {
    const message = await latestEmail(request, email);
    const links = message !== priorEmail ? message.match(/https?:\/\/[^\s<>"')]+/g) ?? [] : [];
    link = links.find((candidate) => candidate.includes('/auth/v1/verify') || candidate.includes('/auth/callback')) ?? '';
    return Boolean(link);
  }, { timeout: 30_000 }).toBe(true);

  await page.goto(link);
  await expect(page).toHaveURL(/\/dashboard/);
}

test('owner and admin can export and retain workspace audit data; member cannot', async ({ browser, request, baseURL }) => {
  test.setTimeout(240_000);
  const service = localServiceClient();
  const workspaceId = randomUUID();
  const marker = `e2e-audit-${randomUUID()}`;
  const oldAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const recentAt = new Date().toISOString();
  const contexts = [] as Awaited<ReturnType<typeof browser.newContext>>[];
  let workspaceCreated = false;

  try {
    const { error: workspaceError } = await service.schema('app').from('workspaces').insert({
      id: workspaceId, name: `E2E audit ${marker}`, slug: marker, created_by: owner.id
    });
    expect(workspaceError).toBeNull();
    workspaceCreated = true;

    const { error: membersError } = await service.schema('app').from('workspace_members').insert(
      [owner, admin, member].map((actor) => ({ workspace_id: workspaceId, user_id: actor.id, role: actor.role }))
    );
    expect(membersError).toBeNull();

    const { data: audits, error: auditError } = await service.schema('app').from('audit_logs').insert([
      {
        workspace_id: workspaceId, actor_type: 'user', actor_user_id: owner.id,
        action: `${marker}.old`, resource_type: 'e2e_audit', resource_id: marker,
        status: 'success', metadata: { fixture: marker, age: 'old' }, created_at: oldAt
      },
      {
        workspace_id: workspaceId, actor_type: 'user', actor_user_id: admin.id,
        action: `${marker}.recent`, resource_type: 'e2e_audit', resource_id: marker,
        status: 'error', metadata: { fixture: marker, age: 'recent' }, created_at: recentAt
      }
    ]).select('id, action');
    expect(auditError).toBeNull();
    expect(audits).toHaveLength(2);
    const oldAuditId = audits?.find((row) => row.action === `${marker}.old`)?.id;
    const recentAuditId = audits?.find((row) => row.action === `${marker}.recent`)?.id;
    expect(oldAuditId).toBeTruthy();
    expect(recentAuditId).toBeTruthy();

    const { data: invocations, error: invocationError } = await service.schema('app').from('tool_invocations').insert([
      {
        workspace_id: workspaceId, provider: 'e2e', tool_name: `${marker}.old`, status: 'success',
        actor_user_id: owner.id, input: { fixture: marker }, output: { age: 'old' }, created_at: oldAt
      },
      {
        workspace_id: workspaceId, provider: 'e2e', tool_name: `${marker}.recent`, status: 'error',
        actor_user_id: admin.id, input: { fixture: marker }, output: { age: 'recent' }, created_at: recentAt
      }
    ]).select('id, tool_name');
    expect(invocationError).toBeNull();
    expect(invocations).toHaveLength(2);
    const oldInvocationId = invocations?.find((row) => row.tool_name === `${marker}.old`)?.id;
    const recentInvocationId = invocations?.find((row) => row.tool_name === `${marker}.recent`)?.id;
    expect(oldInvocationId).toBeTruthy();
    expect(recentInvocationId).toBeTruthy();

    const actorPages = [] as Page[];
    for (const actor of [owner, admin, member]) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page, request, actor.email);
      actorPages.push(page);
    }
    const [ownerPage, adminPage, memberPage] = actorPages;
    const ownerApi = ownerPage.context().request;
    const adminApi = adminPage.context().request;
    const memberApi = memberPage.context().request;
    const auditUrl = `/api/audit?workspace_id=${workspaceId}`;
    const auditExportUrl = `/api/audit/export?workspace_id=${workspaceId}&type=audit&resource_id=${marker}`;
    const invocationExportUrl = `/api/audit/export?workspace_id=${workspaceId}&type=invocations&provider=e2e`;
    const retentionBody = { workspace_id: workspaceId, retention_days: 2 };

    for (const page of [ownerPage, adminPage]) {
      await page.goto(`/audit?workspace=${workspaceId}`);
      await expect(page.getByText(`${marker}.recent`).first()).toBeVisible();
      expect((await page.context().request.get(auditUrl)).status()).toBe(200);
    }
    await memberPage.goto(`/audit?workspace=${workspaceId}`);
    await expect(memberPage.getByText('Workspace owners and admins can review audit events')).toBeVisible();
    await expect(memberPage.getByText(`${marker}.recent`)).toHaveCount(0);
    expect((await memberApi.get(auditUrl)).status()).toBe(403);
    expect((await memberApi.get(auditExportUrl)).status()).toBe(403);
    expect((await memberApi.get(invocationExportUrl)).status()).toBe(403);
    expect((await memberApi.post('/api/audit/retention', { data: { ...retentionBody, target: 'both' } })).status()).toBe(403);

    for (const api of [ownerApi, adminApi]) {
      const auditExport = await api.get(`${auditExportUrl}&format=json&order=asc`);
      expect(auditExport.status()).toBe(200);
      const auditPayload = await auditExport.json();
      expect(auditPayload.workspace.id).toBe(workspaceId);
      expect(auditPayload.rows.map((row: { id: string }) => row.id)).toEqual([oldAuditId, recentAuditId]);
      expect(auditPayload.rows).toEqual([
        expect.objectContaining({ action: `${marker}.old`, metadata: { fixture: marker, age: 'old' } }),
        expect.objectContaining({ action: `${marker}.recent`, metadata: { fixture: marker, age: 'recent' } })
      ]);

      const invocationExport = await api.get(`${invocationExportUrl}&format=json&order=asc`);
      expect(invocationExport.status()).toBe(200);
      const invocationPayload = await invocationExport.json();
      expect(invocationPayload.workspace.id).toBe(workspaceId);
      expect(invocationPayload.rows.map((row: { id: string }) => row.id)).toEqual([oldInvocationId, recentInvocationId]);
      expect(invocationPayload.rows).toEqual([
        expect.objectContaining({ tool_name: `${marker}.old`, output: { age: 'old' } }),
        expect.objectContaining({ tool_name: `${marker}.recent`, output: { age: 'recent' } })
      ]);
    }

    const csv = await ownerApi.get(`${auditExportUrl}&format=csv&order=asc`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(csv.headers()['content-disposition']).toContain('attachment; filename="plusmy-audit-');
    const csvBody = await csv.text();
    expect(csvBody.split('\n')[0]).toBe('id,created_at,actor_type,actor_user_id,actor_client_id,action,resource_type,resource_id,status,ip,user_agent,request_id,metadata');
    expect(csvBody).toContain(oldAuditId!);
    expect(csvBody).toContain(`${marker}.recent`);

    const adminRetention = await adminApi.post('/api/audit/retention', {
      data: { ...retentionBody, target: 'audit' }
    });
    expect(adminRetention.status()).toBe(200);
    expect((await adminRetention.json()).purged).toEqual({ audit_logs: 1, tool_invocations: 0 });

    const afterAudit = await ownerApi.get(`${auditExportUrl}&format=json`);
    expect((await afterAudit.json()).rows.map((row: { id: string }) => row.id)).toEqual([recentAuditId]);
    const beforeInvocationPurge = await ownerApi.get(`${invocationExportUrl}&format=json`);
    expect((await beforeInvocationPurge.json()).rows).toHaveLength(2);

    const ownerRetention = await ownerApi.post('/api/audit/retention', {
      data: { ...retentionBody, target: 'invocations' }
    });
    expect(ownerRetention.status()).toBe(200);
    expect((await ownerRetention.json()).purged).toEqual({ audit_logs: 0, tool_invocations: 1 });

    const afterInvocations = await adminApi.get(`${invocationExportUrl}&format=json`);
    expect((await afterInvocations.json()).rows.map((row: { id: string }) => row.id)).toEqual([recentInvocationId]);
    const finalAudit = await adminApi.get(`${auditExportUrl}&format=json`);
    expect((await finalAudit.json()).rows.map((row: { id: string }) => row.id)).toEqual([recentAuditId]);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (workspaceCreated) {
      const { error } = await service.schema('app').from('workspaces').delete().eq('id', workspaceId);
      expect(error).toBeNull();
    }
  }
});
