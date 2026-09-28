import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

const workspaceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ownerEmail = 'owner@plusmy.local';

function mailpitUrl() {
  if (process.env.E2E_MAILPIT_URL) return process.env.E2E_MAILPIT_URL;
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const line = envFile.split('\n').find((value) => value.startsWith('E2E_MAILPIT_URL='));
  if (!line) throw new Error('E2E_MAILPIT_URL is required for the local magic-link journey.');
  return line.slice('E2E_MAILPIT_URL='.length);
}

async function latestOwnerEmail(request: APIRequestContext) {
  const url = new URL('/view/latest.txt', mailpitUrl());
  url.searchParams.set('query', `to:${ownerEmail}`);
  const response = await request.get(url.toString());
  return response.ok() ? await response.text() : '';
}

function magicLink(message: string) {
  const links = message.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  return links.find((link) => link.includes('/auth/v1/verify') || link.includes('/auth/callback')) ?? '';
}

test('signed-out dashboard does not expose workspace state', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('Sign in required')).toBeVisible();
  await expect(page.getByText('Local Beta Workspace')).toHaveCount(0);
});

test('seeded owner signs in through Mailpit and reaches workspace operator pages', async ({ page, request }) => {
  const priorEmail = await latestOwnerEmail(request);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(ownerEmail);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByText('Magic link sent. Check your inbox.')).toBeVisible();

  let link = '';
  await expect.poll(async () => {
    const message = await latestOwnerEmail(request);
    link = message !== priorEmail ? magicLink(message) : '';
    return Boolean(link);
  }, { timeout: 30_000 }).toBe(true);

  await page.goto(link);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Local Beta Workspace').first()).toBeVisible();

  const response = await page.context().request.get('/api/workspaces');
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: workspaceId, role: 'owner' })]));

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
