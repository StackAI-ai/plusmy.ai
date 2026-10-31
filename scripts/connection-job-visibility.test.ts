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
  const member = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const admin = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const outsider = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const other = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const rows = [
    { id: 'shared', scope: 'workspace', owner_user_id: null },
    { id: 'own', scope: 'personal', owner_user_id: member },
    { id: 'other', scope: 'personal', owner_user_id: other },
    { id: 'orphan', scope: 'personal', owner_user_id: null }
  ];
  let requestedJobIds = '';
  let requestedConnectionFilter = '';
  let connectionReads = 0;
  let connectionTotal: number | null = null;
  let omitConnectionCount = false;
  let failConnectionRead = false;
  let failJobRead = false;

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== 'http://supabase.invalid') throw new Error('Unexpected external request');
    if (url.pathname === '/rest/v1/workspace_members') {
      const actor = url.searchParams.get('user_id');
      return Response.json(actor === `eq.${outsider}` ? [] : [{ user_id: actor?.slice(3) }]);
    }
    if (url.pathname === '/rest/v1/connections') {
      connectionReads += 1;
      assert.equal(url.searchParams.get('workspace_id'), 'eq.workspace');
      if (failConnectionRead) return Response.json({ message: 'temporary failure' }, { status: 503 });
      requestedConnectionFilter = url.searchParams.get('or') ?? '';
      const actor = requestedConnectionFilter.match(/owner_user_id\.eq\.([0-9a-f-]+)/i)?.[1];
      const visible = requestedConnectionFilter ? rows.filter((row) => row.scope === 'workspace' || row.owner_user_id === actor) : rows;
      const total = connectionTotal ?? visible.length;
      return Response.json(visible, { headers: omitConnectionCount ? {} : { 'content-range': `0-${visible.length - 1}/${total}` } });
    }
    if (url.pathname === '/rest/v1/connection_sync_jobs') {
      requestedJobIds = url.searchParams.get('connection_id') ?? '';
      if (failJobRead) return Response.json({ message: 'temporary failure' }, { status: 503 });
      return Response.json([{ id: 'job', connection_id: 'shared', status: 'queued' }]);
    }
    throw new Error(`Unexpected mock request: ${request.method} ${url.pathname}`);
  };

  try {
    const { listConnectionJobs, listConnectionsForWorkspace } = await import('../packages/core/src/connections');
    await t.test('a missing actor never matches an orphaned personal connection', async () => {
      const connections = await listConnectionsForWorkspace('workspace', null);
      assert.deepEqual(connections.map((connection) => connection.id), ['shared']);
    });
    await t.test('a member receives shared and own personal job IDs, never another member\'s', async () => {
      const jobs = await listConnectionJobs('workspace', member, 80);
      assert.equal(jobs.length, 1);
      assert.match(requestedConnectionFilter, new RegExp(member));
      assert.match(requestedJobIds, /shared/);
      assert.match(requestedJobIds, /own/);
      assert.doesNotMatch(requestedJobIds, /other/);
    });
    await t.test('a workspace admin does not receive another member\'s personal job IDs', async () => {
      requestedJobIds = '';
      await listConnectionJobs('workspace', admin, 80);
      assert.match(requestedJobIds, /shared/);
      assert.doesNotMatch(requestedJobIds, /own|other/);
    });
    await t.test('uppercase actor UUIDs still include the actor\'s own jobs', async () => {
      requestedJobIds = '';
      await listConnectionJobs('workspace', member.toUpperCase(), 80);
      assert.match(requestedJobIds, /own/);
      const connections = await listConnectionsForWorkspace('workspace', member.toUpperCase());
      assert.deepEqual(connections.map((connection) => connection.id), ['shared', 'own']);
    });
    await t.test('a nonmember cannot trigger a connection or job read', async () => {
      requestedJobIds = '';
      const before = connectionReads;
      assert.deepEqual(await listConnectionJobs('workspace', outsider, 80), []);
      assert.equal(connectionReads, before);
      assert.equal(requestedJobIds, '');
    });
    await t.test('a malformed actor cannot inject a PostgREST visibility filter', async () => {
      const before = connectionReads;
      await assert.rejects(listConnectionJobs('workspace', `${member}),scope.eq.personal`, 80), /valid actor/);
      assert.equal(connectionReads, before);
    });
    await t.test('a truncated connection list does not report a partial job count', async () => {
      requestedJobIds = '';
      connectionTotal = rows.length + 1;
      await assert.rejects(listConnectionJobs('workspace', member, 80), /complete connection visibility/);
      assert.equal(requestedJobIds, '');
      connectionTotal = null;
    });
    await t.test('a missing exact count or failed connection query is surfaced', async () => {
      omitConnectionCount = true;
      await assert.rejects(listConnectionJobs('workspace', member, 80), /complete connection visibility/);
      omitConnectionCount = false;
      failConnectionRead = true;
      await assert.rejects(listConnectionJobs('workspace', member, 80), /complete connection visibility/);
      failConnectionRead = false;
    });
    await t.test('a job query failure is surfaced instead of returning zero', async () => {
      failJobRead = true;
      await assert.rejects(listConnectionJobs('workspace', member, 80), /Unable to load connection job status/);
      failJobRead = false;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
