import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service',
  MCP_JWT_SECRET: 'fake-mcp-secret-at-least-thirty-two-bytes',
  WORKER_SHARED_SECRET: 'fake-worker-secret-at-least-thirty-two-bytes'
});

test('dashboard job reads are limited to a workspace member\'s visible connections', async (t) => {
  const originalFetch = globalThis.fetch;
  const rows = [
    { id: 'shared', scope: 'workspace', owner_user_id: null },
    { id: 'own', scope: 'personal', owner_user_id: 'member' },
    { id: 'other', scope: 'personal', owner_user_id: 'other-member' }
  ];
  let requestedJobIds = '';
  let connectionReads = 0;

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== 'http://supabase.invalid') throw new Error('Unexpected external request');
    if (url.pathname === '/rest/v1/workspace_members') {
      const actor = url.searchParams.get('user_id');
      return Response.json(actor === 'eq.outsider' ? [] : [{ user_id: actor?.slice(3) }]);
    }
    if (url.pathname === '/rest/v1/connections') {
      connectionReads += 1;
      return Response.json(rows);
    }
    if (url.pathname === '/rest/v1/connection_sync_jobs') {
      requestedJobIds = url.searchParams.get('connection_id') ?? '';
      return Response.json([{ id: 'job', connection_id: 'shared', status: 'queued' }]);
    }
    throw new Error(`Unexpected mock request: ${request.method} ${url.pathname}`);
  };

  try {
    const { listConnectionJobs } = await import('../packages/core/src/connections');
    await t.test('a member receives shared and own personal job IDs, never another member\'s', async () => {
      const jobs = await listConnectionJobs('workspace', 'member', 80);
      assert.equal(jobs.length, 1);
      assert.match(requestedJobIds, /shared/);
      assert.match(requestedJobIds, /own/);
      assert.doesNotMatch(requestedJobIds, /other/);
    });
    await t.test('a workspace admin does not receive another member\'s personal job IDs', async () => {
      requestedJobIds = '';
      await listConnectionJobs('workspace', 'admin', 80);
      assert.match(requestedJobIds, /shared/);
      assert.doesNotMatch(requestedJobIds, /own|other/);
    });
    await t.test('a nonmember cannot trigger a connection or job read', async () => {
      requestedJobIds = '';
      const before = connectionReads;
      assert.deepEqual(await listConnectionJobs('workspace', 'outsider', 80), []);
      assert.equal(connectionReads, before);
      assert.equal(requestedJobIds, '');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
