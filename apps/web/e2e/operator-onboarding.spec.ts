import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

const workspaceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const isolatedWorkspaceId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ownerEmail = 'owner@plusmy.local';
const adminEmail = 'admin@plusmy.local';
const memberEmail = 'member@plusmy.local';

function mailpitUrl() {
  if (process.env.E2E_MAILPIT_URL) return process.env.E2E_MAILPIT_URL;
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const line = envFile.split('\n').find((value) => value.startsWith('E2E_MAILPIT_URL='));
  if (!line) throw new Error('E2E_MAILPIT_URL is required for the local magic-link journey.');
  return line.slice('E2E_MAILPIT_URL='.length);
}

function localServiceClient() {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const readValue = (key: string) => envFile.split('\n').find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
  const url = readValue('NEXT_PUBLIC_SUPABASE_URL');
  const key = readValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Local Supabase service configuration is required for E2E cleanup.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function localEnvValue(key: string) {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const value = envFile.split('\n').find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
  if (!value) throw new Error(`${key} is required for local E2E.`);
  return value;
}

async function latestEmail(request: APIRequestContext, email: string) {
  const url = new URL('/view/latest.txt', mailpitUrl());
  url.searchParams.set('query', `to:${email}`);
  const response = await request.get(url.toString());
  return response.ok() ? await response.text() : '';
}

function magicLink(message: string) {
  const links = message.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  return links.find((link) => link.includes('/auth/v1/verify') || link.includes('/auth/callback')) ?? '';
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
    link = message !== priorEmail ? magicLink(message) : '';
    return Boolean(link);
  }, { timeout: 30_000 }).toBe(true);

  await page.goto(link);
  await expect(page).toHaveURL(/\/dashboard/);
}

test('signed-out dashboard does not expose workspace state', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('Sign in required')).toBeVisible();
  await expect(page.getByText('Local Beta Workspace')).toHaveCount(0);
});

test('connection ownership and callback state stay bound to the acting user', async ({ browser, page, request }) => {
  const service = localServiceClient();
  const suffix = Date.now().toString(36);
  const { data: fixtures, error } = await service.schema('app').from('connections').insert([
    {
      connection_key: `e2e-personal-${suffix}`,
      workspace_id: workspaceId,
      owner_user_id: '33333333-3333-3333-3333-333333333333',
      provider: 'hubspot', scope: 'personal', status: 'active', display_name: `E2E personal ${suffix}`
    },
    {
      connection_key: `e2e-workspace-${suffix}`,
      workspace_id: workspaceId,
      provider: 'hubspot', scope: 'workspace', status: 'active', display_name: `E2E workspace ${suffix}`
    }
  ]).select('id, scope');
  expect(error).toBeNull();
  const personalId = fixtures?.find((row) => row.scope === 'personal')?.id;
  const sharedId = fixtures?.find((row) => row.scope === 'workspace')?.id;
  expect(personalId).toBeTruthy();
  expect(sharedId).toBeTruthy();

  const adminContext = await browser.newContext({ baseURL: 'http://localhost:3009' });
  const memberContext = await browser.newContext({ baseURL: 'http://localhost:3009' });
  try {
    const adminPage = await adminContext.newPage();
    await signIn(adminPage, request, adminEmail);
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, request, memberEmail);
    const adminApi = adminContext.request;
    const memberApi = memberContext.request;

    const adminListing = await adminApi.get(`/api/connections?workspace_id=${workspaceId}`);
    expect((await adminListing.json()).connections).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: personalId })]));
    const memberListing = await memberApi.get(`/api/connections?workspace_id=${workspaceId}`);
    expect((await memberListing.json()).connections).toEqual(expect.arrayContaining([expect.objectContaining({ id: personalId })]));

    for (const [path, method] of [
      ['/api/connections', 'delete'], ['/api/connections/refresh', 'post'], ['/api/connections/sync', 'post']
    ] as const) {
      const body = { workspace_id: workspaceId, connection_id: personalId };
      expect((await adminApi[method](path, { data: body })).status()).toBe(403);
      expect((await memberApi[method](path, { data: { ...body, connection_id: sharedId } })).status()).toBe(403);
    }
    for (const path of ['/api/connections/refresh', '/api/connections/sync']) {
      expect((await adminApi.post(path, {
        data: '{invalid', headers: { 'content-type': 'application/json' }
      })).status()).toBe(400);
    }
    const personalSync = await memberApi.post('/api/connections/sync', {
      data: { workspace_id: workspaceId, connection_id: personalId }
    });
    expect(personalSync.status()).toBe(200);
    const personalJobId = (await personalSync.json()).job_id;
    expect((await adminApi.post('/api/connections/sync', {
      data: { workspace_id: workspaceId, connection_id: sharedId }
    })).status()).toBe(200);
    const { data: queuedAudit } = await service.schema('app').from('audit_logs')
      .select('actor_user_id').eq('resource_id', personalJobId).eq('action', 'connection_job.queued').single();
    expect(queuedAudit?.actor_user_id).toBe('33333333-3333-3333-3333-333333333333');

    const state = await new SignJWT({
      provider: 'hubspot', userId: '33333333-3333-3333-3333-333333333333',
      workspaceId, connectionScope: 'personal', redirectTo: '/connections'
    }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime('10m')
      .sign(new TextEncoder().encode(localEnvValue('MCP_JWT_SECRET')));
    const callback = `/api/integrations/hubspot/callback?code=disposable&state=${encodeURIComponent(state)}`;
    expect((await request.get(`http://localhost:3009${callback}`)).status()).toBe(401);
    expect((await adminApi.get(callback)).status()).toBe(403);

    expect((await memberApi.delete('/api/connections', {
      data: { workspace_id: workspaceId, connection_id: personalId }
    })).status()).toBe(200);
    expect((await memberApi.post('/api/connections/sync', {
      data: { workspace_id: workspaceId, connection_id: personalId }
    })).status()).toBe(400);
    expect((await memberApi.post('/api/connections/refresh', {
      data: { workspace_id: workspaceId, connection_id: personalId }
    })).status()).toBe(400);
    expect((await adminApi.delete('/api/connections', {
      data: { workspace_id: workspaceId, connection_id: sharedId }
    })).status()).toBe(200);
    const { data: revokedAudit } = await service.schema('app').from('audit_logs')
      .select('actor_user_id').eq('resource_id', personalId).eq('action', 'connection.revoked').single();
    expect(revokedAudit?.actor_user_id).toBe('33333333-3333-3333-3333-333333333333');
  } finally {
    await adminContext.close();
    await memberContext.close();
    await service.schema('app').from('connections').delete().in('id', [personalId, sharedId].filter(Boolean));
  }
});

test('seeded owner signs in through Mailpit and reaches workspace operator pages', async ({ page, request }) => {
  test.setTimeout(180_000);
  await signIn(page, request, ownerEmail);
  await expect(page.getByText('Local Beta Workspace').first()).toBeVisible();

  const response = await page.context().request.get('/api/workspaces');
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: workspaceId, role: 'owner' })]));
  expect(payload.workspaces).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: isolatedWorkspaceId })]));

  const api = page.context().request;
  const membersResponse = await api.get(`/api/workspace-members?workspace_id=${workspaceId}`);
  const { members } = await membersResponse.json();
  const member = members.find((entry: { user_id: string }) => entry.user_id === '33333333-3333-3333-3333-333333333333');
  expect(member?.role).toBe('member');
  try {
    const promote = await api.patch('/api/workspace-members', {
      data: { workspace_id: workspaceId, member_id: member.id, role: 'admin' }
    });
    expect(promote.status()).toBe(200);
    const promoted = await api.get(`/api/workspace-members?workspace_id=${workspaceId}`);
    expect((await promoted.json()).members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: member.id, role: 'admin' })
    ]));
  } finally {
    const restore = await api.patch('/api/workspace-members', {
      data: { workspace_id: workspaceId, member_id: member.id, role: 'member' }
    });
    expect(restore.status()).toBe(200);
  }

  for (const [path, heading] of [
    ['/workspaces', 'Your workspaces'],
    ['/connections', 'Business tools'],
    ['/context', 'Vectorized context and skill engine'],
    ['/mcp-clients', 'MCP clients'],
    ['/audit', 'Audit and rate control'],
    ['/onboarding', 'Launch sequence']
  ]) {
    await page.goto(`${path}?workspace=${workspaceId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sign in required')).toHaveCount(0);
  }
});

test('workspace admin can audit and manage member invites but cannot grant ownership', async ({ page, request }) => {
  await signIn(page, request, adminEmail);
  const api = page.context().request;

  const workspaces = await api.get('/api/workspaces');
  expect((await workspaces.json()).workspaces).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: workspaceId, role: 'admin' })
  ]));
  expect((await api.get(`/api/audit?workspace_id=${workspaceId}`)).status()).toBe(200);
  expect((await api.get(`/api/workspace-members?workspace_id=${isolatedWorkspaceId}`)).status()).toBe(404);

  const membersResponse = await api.get(`/api/workspace-members?workspace_id=${workspaceId}`);
  const { members } = await membersResponse.json();
  const owner = members.find((entry: { user_id: string }) => entry.user_id === '11111111-1111-1111-1111-111111111111');
  expect(owner?.role).toBe('owner');
  expect((await api.patch('/api/workspace-members', {
    data: { workspace_id: workspaceId, member_id: owner.id, role: 'member' }
  })).status()).toBe(403);

  const ownerInvite = await api.post('/api/workspace-invites', {
    data: { workspace_id: workspaceId, email: 'candidate-owner@plusmy.local', role: 'owner' }
  });
  expect(ownerInvite.status()).toBe(403);

  const create = await api.post('/api/workspace-invites', {
    data: { workspace_id: workspaceId, email: `candidate-${Date.now()}@plusmy.local`, role: 'member' }
  });
  expect(create.status()).toBe(201);
  const { invite } = await create.json();
  try {
    expect(invite.role).toBe('member');
    const listing = await api.get(`/api/workspace-invites?workspace_id=${workspaceId}`);
    expect((await listing.json()).invites).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: invite.id })
    ]));
  } finally {
    const revoke = await api.delete('/api/workspace-invites', {
      data: { workspace_id: workspaceId, invite_id: invite.id }
    });
    expect(revoke.status()).toBe(200);
  }
});

test('workspace member cannot mutate membership or inspect admin-only data', async ({ page, request }) => {
  await signIn(page, request, memberEmail);
  const api = page.context().request;
  const workspaces = await api.get('/api/workspaces');
  expect((await workspaces.json()).workspaces).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: workspaceId, role: 'member' })
  ]));

  const membersResponse = await api.get(`/api/workspace-members?workspace_id=${workspaceId}`);
  expect(membersResponse.status()).toBe(200);
  const { members } = await membersResponse.json();
  const self = members.find((entry: { user_id: string }) => entry.user_id === '33333333-3333-3333-3333-333333333333');
  expect(self).toBeTruthy();

  expect((await api.patch('/api/workspace-members', {
    data: { workspace_id: workspaceId, member_id: self.id, role: 'admin' }
  })).status()).toBe(403);
  expect((await api.post('/api/workspace-invites', {
    data: { workspace_id: workspaceId, email: 'candidate-member@plusmy.local', role: 'member' }
  })).status()).toBe(403);
  expect((await api.get(`/api/audit?workspace_id=${workspaceId}`)).status()).toBe(403);
  expect((await api.get(`/api/audit/export?workspace_id=${workspaceId}`)).status()).toBe(403);
  expect((await api.get(`/api/workspace-members?workspace_id=${isolatedWorkspaceId}`)).status()).toBe(404);
  expect((await api.get(`/api/connections?workspace_id=${isolatedWorkspaceId}`)).status()).toBe(404);
});

test('invited user joins through the browser and the link cannot be replayed', async ({ page, request, browser }) => {
  await signIn(page, request, ownerEmail);
  const ownerApi = page.context().request;
  const create = await ownerApi.post('/api/workspace-invites', {
    data: { workspace_id: workspaceId, email: 'outsider@plusmy.local', role: 'member' }
  });
  expect(create.status()).toBe(201);
  const { invite } = await create.json();
  expect(invite.token_hash).toBeUndefined();

  const invitedContext = await browser.newContext({ baseURL: 'http://localhost:3009' });
  try {
    const wrongUser = await ownerApi.post('/api/workspace-invites/accept', {
      data: { token: invite.invite_token }
    });
    expect(wrongUser.status()).toBe(403);

    const invitedPage = await invitedContext.newPage();
    await signIn(invitedPage, request, 'outsider@plusmy.local');
    await invitedPage.goto(`/join?token=${invite.invite_token}`);
    for (const link of await invitedPage.getByRole('navigation').getByRole('link').all()) {
      expect(await link.getAttribute('href')).not.toContain('token=');
    }
    await invitedPage.getByRole('button', { name: 'Accept invite' }).click();
    await expect(invitedPage).toHaveURL(/\/workspaces/);

    const invitedApi = invitedContext.request;
    const workspaces = await invitedApi.get('/api/workspaces');
    expect((await workspaces.json()).workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: workspaceId, role: 'member' }),
      expect.objectContaining({ id: isolatedWorkspaceId, role: 'owner' })
    ]));
    const replay = await invitedApi.post('/api/workspace-invites/accept', {
      data: { token: invite.invite_token }
    });
    expect(replay.status()).toBe(409);
  } finally {
    await invitedContext.close();
    const membersResponse = await ownerApi.get(`/api/workspace-members?workspace_id=${workspaceId}`);
    const { members } = await membersResponse.json();
    const outsider = members.find((entry: { user_id: string }) => entry.user_id === '44444444-4444-4444-4444-444444444444');
    if (outsider) {
      const remove = await ownerApi.delete('/api/workspace-members', {
        data: { workspace_id: workspaceId, member_id: outsider.id }
      });
      expect(remove.status()).toBe(200);
    }
    const revoke = await ownerApi.delete('/api/workspace-invites', {
      data: { workspace_id: workspaceId, invite_id: invite.id }
    });
    expect(revoke.status()).toBe(200);
  }
});

test('shared context mutations require an admin while personal context stays private', async ({ page, request, browser }) => {
  await signIn(page, request, ownerEmail);
  const ownerApi = page.context().request;
  const memberContext = await browser.newContext({ baseURL: 'http://localhost:3009' });
  const created: Record<'asset' | 'prompt' | 'skill' | 'binding' | 'personalPrompt', string | null> = {
    asset: null, prompt: null, skill: null, binding: null, personalPrompt: null
  };
  const suffix = Date.now().toString(36);

  try {
    const sharedAsset = await ownerApi.post('/api/context-assets', {
      data: { workspace_id: workspaceId, scope: 'workspace', type: 'document', title: `E2E asset ${suffix}`, content: 'Disposable context evidence.' }
    });
    expect(sharedAsset.status()).toBe(201);
    created.asset = (await sharedAsset.json()).asset.id;

    const sharedPrompt = await ownerApi.post('/api/prompts', {
      data: { workspace_id: workspaceId, scope: 'workspace', name: `E2E prompt ${suffix}`, content: 'Use approved workspace context.' }
    });
    expect(sharedPrompt.status()).toBe(201);
    created.prompt = (await sharedPrompt.json()).prompt.id;

    const sharedSkill = await ownerApi.post('/api/skills', {
      data: { workspace_id: workspaceId, scope: 'workspace', name: `E2E skill ${suffix}`, instructions: 'Cite approved evidence.' }
    });
    expect(sharedSkill.status()).toBe(201);
    created.skill = (await sharedSkill.json()).skill.id;

    const binding = await ownerApi.post('/api/context-bindings', {
      data: { workspace_id: workspaceId, binding_type: 'workspace', target_key: 'default', prompt_template_id: created.prompt, skill_definition_id: created.skill }
    });
    expect(binding.status()).toBe(201);
    created.binding = (await binding.json()).binding.id;

    await page.goto(`/context?workspace=${workspaceId}`);
    await expect(page.getByText(`E2E asset ${suffix}`).first()).toBeVisible();
    await expect(page.getByText(`E2E prompt ${suffix}`).first()).toBeVisible();
    await expect(page.getByText(`E2E skill ${suffix}`).first()).toBeVisible();
    await page.locator('#binding-type').click();
    await page.getByRole('option', { name: 'Provider' }).click();
    await page.locator('#binding-target').click();
    await expect(page.getByRole('option', { name: 'HubSpot' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'QuickBooks Online' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#binding-type').click();
    await page.getByRole('option', { name: 'Tool' }).click();
    await expect(page.getByText('Install a workspace connection before binding a specific tool.')).toBeVisible();

    const memberPage = await memberContext.newPage();
    await signIn(memberPage, request, memberEmail);
    const memberApi = memberContext.request;
    for (const [path, data] of [
      ['/api/context-assets', { workspace_id: workspaceId, scope: 'workspace', type: 'document', title: `Denied asset ${suffix}`, content: 'Denied.' }],
      ['/api/prompts', { workspace_id: workspaceId, scope: 'workspace', name: `Denied prompt ${suffix}`, content: 'Denied.' }],
      ['/api/skills', { workspace_id: workspaceId, scope: 'workspace', name: `Denied skill ${suffix}`, instructions: 'Denied.' }]
    ] as const) {
      expect((await memberApi.post(path, { data })).status()).toBe(403);
    }
    expect((await memberApi.patch('/api/prompts', {
      data: { workspace_id: workspaceId, prompt_id: created.prompt, name: `Changed ${suffix}`, content: 'Denied.' }
    })).status()).toBe(403);
    expect((await memberApi.patch('/api/skills', {
      data: { workspace_id: workspaceId, skill_id: created.skill, name: `Changed ${suffix}`, instructions: 'Denied.' }
    })).status()).toBe(403);
    expect((await memberApi.post('/api/context-bindings', {
      data: { workspace_id: workspaceId, binding_type: 'workspace', target_key: 'default', prompt_template_id: created.prompt }
    })).status()).toBe(403);

    const personalPrompt = await memberApi.post('/api/prompts', {
      data: { workspace_id: workspaceId, scope: 'personal', name: `Private prompt ${suffix}`, content: 'Member-only context.' }
    });
    expect(personalPrompt.status()).toBe(201);
    created.personalPrompt = (await personalPrompt.json()).prompt.id;
    const ownerPrompts = await ownerApi.get(`/api/prompts?workspace_id=${workspaceId}`);
    expect((await ownerPrompts.json()).prompts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.personalPrompt })]));
    const memberPrompts = await memberApi.get(`/api/prompts?workspace_id=${workspaceId}`);
    expect((await memberPrompts.json()).prompts).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.personalPrompt })]));
    expect((await ownerApi.patch('/api/prompts', {
      data: { workspace_id: workspaceId, prompt_id: created.personalPrompt, name: `Stolen ${suffix}`, content: 'Denied.' }
    })).status()).toBe(403);
    expect((await memberApi.patch('/api/prompts', {
      data: { workspace_id: workspaceId, prompt_id: created.personalPrompt, name: `Private edited ${suffix}`, content: 'Member-owned context.' }
    })).status()).toBe(200);
    expect((await memberApi.post('/api/prompts', {
      data: { workspace_id: isolatedWorkspaceId, scope: 'workspace', name: `Denied isolated ${suffix}`, content: 'Denied.' }
    })).status()).toBe(404);

    const removeBinding = await ownerApi.delete('/api/context-bindings', {
      data: { workspace_id: workspaceId, binding_id: created.binding }
    });
    expect(removeBinding.status()).toBe(200);
    created.binding = null;
  } finally {
    await memberContext.close();
    const service = localServiceClient();
    if (created.binding) await service.schema('app').from('context_bindings').delete().eq('id', created.binding);
    if (created.prompt) await service.schema('app').from('context_assets').delete().eq('source_uri', `plusmy://prompt/${created.prompt}`);
    if (created.skill) await service.schema('app').from('context_assets').delete().eq('source_uri', `plusmy://skill/${created.skill}`);
    if (created.asset) await service.schema('app').from('context_assets').delete().eq('id', created.asset);
    if (created.prompt) await service.schema('app').from('prompt_templates').delete().eq('id', created.prompt);
    if (created.skill) await service.schema('app').from('skill_definitions').delete().eq('id', created.skill);
    if (created.personalPrompt) await service.schema('app').from('prompt_templates').delete().eq('id', created.personalPrompt);
  }
});
