import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const workspaceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ownerEmail = 'owner@plusmy.local';
const redirectUri = 'http://localhost:3009/mcp-setup';

function envValue(key: string) {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const value = content.split('\n').find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
  if (!value) throw new Error(`${key} is required for local E2E.`);
  return value;
}

function serviceClient() {
  return createClient(envValue('NEXT_PUBLIC_SUPABASE_URL'), envValue('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false }
  });
}

async function latestEmail(request: APIRequestContext) {
  const url = new URL('/view/latest.txt', envValue('E2E_MAILPIT_URL'));
  url.searchParams.set('query', `to:${ownerEmail}`);
  const response = await request.get(url.toString());
  return response.ok() ? await response.text() : '';
}

async function signIn(page: Page, request: APIRequestContext) {
  const previous = await latestEmail(request);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  let link = '';
  await expect.poll(async () => {
    const message = await latestEmail(request);
    link = message !== previous
      ? (message.match(/https?:\/\/[^\s<>"')]+/g) ?? []).find((value) => value.includes('/auth/v1/verify') || value.includes('/auth/callback')) ?? ''
      : '';
    return Boolean(link);
  }, { timeout: 30_000 }).toBe(true);
  await page.goto(link);
  await expect(page).toHaveURL(/\/dashboard/);
}

function authorizeUrl(clientId: string, challenge: string, scope: string) {
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    workspace_id: workspaceId, scope, state: 'e2e-state',
    code_challenge: challenge, code_challenge_method: 'S256'
  });
  return `/authorize?${params.toString()}`;
}

async function mcpCall(request: APIRequestContext, token: string, method: string, id: number, params?: Record<string, unknown>) {
  const response = await request.post('/mcp', {
    headers: { authorization: `Bearer ${token}` },
    data: { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
  });
  return { status: response.status(), body: await response.json() };
}

test('MCP consent, PKCE exchange, scope narrowing, and revocation work end to end', async ({ page, request }) => {
  test.setTimeout(180_000);
  const service = serviceClient();
  const maliciousName = 'Beta <img src=x onerror="window.__mcpXss=1"> client';
  const registration = await request.post('/register', {
    data: { client_name: maliciousName, redirect_uris: [redirectUri], scope: 'mcp:tools mcp:resources' }
  });
  expect(registration.status()).toBe(201);
  const clientId = (await registration.json()).client_id as string;
  let promptId: string | null = null;
  let approvalId: string | null = null;
  try {
    await signIn(page, request);
    const ownerApi = page.context().request;
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const fullUrl = authorizeUrl(clientId, challenge, 'mcp:tools mcp:resources');

    const missingPkce = await ownerApi.get(fullUrl.replace(/&code_challenge=[^&]+/, ''));
    expect(missingPkce.status()).toBe(400);
    await page.goto(fullUrl);
    await expect(page.getByRole('heading', { name: `Authorize ${maliciousName}` })).toBeVisible();
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => (window as Window & { __mcpXss?: number }).__mcpXss)).toBeUndefined();

    await page.getByRole('button', { name: 'Deny' }).click();
    await expect(page).toHaveURL(/error=access_denied/);
    const deniedApprovals = await ownerApi.get(`/api/oauth-clients/approvals?workspace_id=${workspaceId}`);
    expect((await deniedApprovals.json()).approvals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ client_id: clientId })
    ]));

    await page.goto(fullUrl);
    await page.getByRole('button', { name: 'Approve access' }).click();
    await expect(page).toHaveURL(/code=/);
    const code = new URL(page.url()).searchParams.get('code');
    expect(code).toBeTruthy();
    const wrongVerifier = await request.post('/token', { form: {
      grant_type: 'authorization_code', code: code!, redirect_uri: redirectUri,
      client_id: clientId, code_verifier: randomBytes(48).toString('base64url')
    } });
    expect(wrongVerifier.status()).toBe(400);

    const exchange = () => request.post('/token', { form: {
      grant_type: 'authorization_code', code: code!, redirect_uri: redirectUri,
      client_id: clientId, code_verifier: verifier
    } });
    const raced = await Promise.all([exchange(), exchange()]);
    expect(raced.map((response) => response.status()).sort()).toEqual([200, 400]);
    const fullToken = await raced.find((response) => response.status() === 200)!.json();
    expect(fullToken.scope).toBe('mcp:tools mcp:resources');
    expect((await mcpCall(request, fullToken.access_token, 'initialize', 1)).body.result.serverInfo.name).toBe('plusmy.ai');
    expect((await mcpCall(request, fullToken.access_token, 'tools/list', 2)).body.result.tools).toEqual([]);

    const prompt = await ownerApi.post('/api/prompts', { data: {
      workspace_id: workspaceId, scope: 'workspace', name: `MCP E2E ${Date.now()}`,
      content: 'Disposable authorization evidence.'
    } });
    expect(prompt.status()).toBe(201);
    promptId = (await prompt.json()).prompt.id;
    const resources = (await mcpCall(request, fullToken.access_token, 'resources/list', 3)).body.result.resources as { uri: string }[];
    const resourceUri = `plusmy://prompt/${promptId}`;
    expect(resources).toEqual(expect.arrayContaining([expect.objectContaining({ uri: resourceUri })]));
    const read = await mcpCall(request, fullToken.access_token, 'resources/read', 4, { uri: resourceUri });
    expect(read.body.result.contents[0].text).toContain('Disposable authorization evidence.');

    const refresh = () => request.post('/token', { form: {
      grant_type: 'refresh_token', refresh_token: fullToken.refresh_token, client_id: clientId
    } });
    const refreshRace = await Promise.all([refresh(), refresh()]);
    expect(refreshRace.map((response) => response.status()).sort()).toEqual([200, 400]);
    const rotatedToken = await refreshRace.find((response) => response.status() === 200)!.json();
    expect((await mcpCall(request, rotatedToken.access_token, 'resources/list', 5)).body.result.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: resourceUri })])
    );

    const approvals = await ownerApi.get(`/api/oauth-clients/approvals?workspace_id=${workspaceId}`);
    approvalId = (await approvals.json()).approvals.find((entry: { client_id: string }) => entry.client_id === clientId)?.id ?? null;
    expect(approvalId).toBeTruthy();

    const narrowVerifier = randomBytes(48).toString('base64url');
    const narrowChallenge = createHash('sha256').update(narrowVerifier).digest('base64url');
    await page.goto(authorizeUrl(clientId, narrowChallenge, 'mcp:resources'));
    await page.getByRole('button', { name: 'Approve access' }).click();
    await expect(page).toHaveURL(/code=/);
    const narrowCode = new URL(page.url()).searchParams.get('code');
    const narrowed = await request.post('/token', { form: {
      grant_type: 'authorization_code', code: narrowCode!, redirect_uri: redirectUri,
      client_id: clientId, code_verifier: narrowVerifier
    } });
    expect(narrowed.status()).toBe(200);
    const narrowToken = await narrowed.json();
    expect((await mcpCall(request, fullToken.access_token, 'tools/list', 6)).status).toBe(401);
    const oldRefresh = await request.post('/token', { form: {
      grant_type: 'refresh_token', refresh_token: rotatedToken.refresh_token, client_id: clientId
    } });
    expect(oldRefresh.status()).toBe(400);
    expect((await mcpCall(request, narrowToken.access_token, 'tools/list', 7)).body.error.code).toBe(-32003);
    expect((await mcpCall(request, narrowToken.access_token, 'resources/list', 8)).body.result.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: resourceUri })])
    );

    const revoke = await ownerApi.delete('/api/oauth-clients/approvals', {
      data: { workspace_id: workspaceId, approval_id: approvalId }
    });
    expect(revoke.status()).toBe(200);
    expect((await mcpCall(request, narrowToken.access_token, 'resources/list', 9)).status).toBe(401);
    expect((await request.post('/token', { form: {
      grant_type: 'refresh_token', refresh_token: narrowToken.refresh_token, client_id: clientId
    } })).status()).toBe(400);
    const { data: audit } = await service.schema('app').from('audit_logs').select('action')
      .eq('resource_id', approvalId).in('action', ['oauth_client.approved', 'oauth_client.approval_revoked']);
    expect(audit?.filter((entry) => entry.action === 'oauth_client.approved')).toHaveLength(2);
    expect(audit?.filter((entry) => entry.action === 'oauth_client.approval_revoked')).toHaveLength(1);
  } finally {
    if (promptId) {
      await service.schema('app').from('context_assets').delete().eq('source_uri', `plusmy://prompt/${promptId}`);
      await service.schema('app').from('prompt_templates').delete().eq('id', promptId);
    }
    if (approvalId) await service.schema('app').from('audit_logs').delete().eq('resource_id', approvalId);
    await service.schema('app').from('audit_logs').delete().eq('resource_id', clientId);
    await service.schema('app').from('oauth_clients').delete().eq('client_id', clientId);
  }
});
