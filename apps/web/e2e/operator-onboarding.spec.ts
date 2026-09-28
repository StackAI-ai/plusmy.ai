import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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

test('seeded owner signs in through Mailpit and reaches workspace operator pages', async ({ page, request }) => {
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
    await page.goto(`${path}?workspace=${workspaceId}`);
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
