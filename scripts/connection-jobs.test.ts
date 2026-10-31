import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service', GITHUB_CLIENT_ID: 'fake-client', GITHUB_CLIENT_SECRET: 'fake-secret',
  MCP_JWT_SECRET: 'fake-mcp-secret-at-least-thirty-two-bytes',
  WORKER_SHARED_SECRET: 'fake-worker-secret-at-least-thirty-two-bytes', OPENAI_API_KEY: '', OPERATOR_ALERT_WEBHOOK_URL: ''
});

test('connection worker uses claim fences for all local effects', async (t) => {
  const originalFetch = globalThis.fetch;
  const core = await import('../packages/core/src/connections');
  const { getIntegration } = await import('../packages/integrations/src/index');
  const integration = getIntegration('github')!;
  const handler = integration.syncJobs!.find((entry) => entry.jobType === 'sync_connection')!;
  const originalSync = handler.run;
  const originalRefresh = integration.refreshTokens;
  let connection: Record<string, any>;
  let jobs: Array<Record<string, any>>;
  let audits: Array<Record<string, any>>;
  let calls: Array<{ path: string; body: Record<string, any> }>;
  let refreshToken: string;
  let credentialExpiry: string | null;
  let beforeFinish: (() => void) | undefined;
  let afterCommit: (() => void) | undefined;
  let loseFinishAck: boolean;
  function reset(type = 'sync_connection', attempts = 0) {
    connection = {
      id: 'connection', workspace_id: 'workspace', provider: 'github', status: 'active', scope: 'workspace',
      display_name: 'Original', metadata: {}, job_generation: 'generation-1', expires_at: null,
      refresh_lock_id: null, reauth_required_reason: null
    };
    jobs = [{ id: 'job', connection_id: connection.id, connection_generation: connection.job_generation,
      job_type: type, payload: {}, status: 'queued', attempts, max_attempts: 3, claim_id: null }];
    calls = []; audits = []; refreshToken = 'old-refresh'; credentialExpiry = null;
    beforeFinish = undefined; afterCommit = undefined;
    loseFinishAck = false;
    integration.refreshTokens = async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh', scopes: [], expiresAt: '2999-01-01T00:00:00Z' });
    handler.run = async () => ({ displayName: 'Synced', metadata: { source: 'provider' } });
  }
  function invalidate(status = 'revoked') {
    connection.status = status;
    connection.job_generation = 'generation-2';
    connection.refresh_lock_id = null;
    for (const job of jobs) if (['queued', 'processing'].includes(job.status)) {
      Object.assign(job, { status: 'canceled', claim_id: null, worker_id: null });
    }
  }
  function owned(body: Record<string, any>) {
    return jobs.find((job) => job.id === body.p_job_id && body.p_claim_id && job.claim_id === body.p_claim_id
      && job.status === 'processing' && job.connection_generation === connection.job_generation);
  }
  function blockedSync() {
    let start!: () => void; let finish!: () => void; let fail!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    handler.run = async () => {
      start();
      return await new Promise((resolve, reject) => {
        finish = () => resolve({ displayName: 'Stale provider result', metadata: { stale: true } });
        fail = () => reject(new Error('provider failed'));
      });
    };
    return { started, finish: () => finish(), fail: () => fail() };
  }
  reset();
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, 'http://supabase.invalid', 'no external provider/network access');
    const body = request.method === 'GET' ? {} : await request.json() as Record<string, any>;
    const path = url.pathname;
    calls.push({ path, body });
    if (path === '/rest/v1/connections') {
      if (request.method === 'GET') return Response.json([connection]);
      if (request.method === 'PATCH') {
        if (body.status === 'revoked') invalidate();
        Object.assign(connection, body);
        return new Response(null, { status: 204 });
      }
    }
    if (path === '/rest/v1/connection_credentials') return Response.json([{
      access_token_secret_id: 'access', refresh_token_secret_id: 'refresh', expires_at: credentialExpiry, token_type: 'Bearer'
    }]);
    if (path === '/rest/v1/rpc/resolve_secret') return Response.json(body.p_secret_id === 'access' ? 'access-token' : refreshToken);
    if (path === '/rest/v1/audit_logs') { audits.push(body); return new Response(null, { status: 201 }); }
    if (path === '/rest/v1/rpc/claim_connection_sync_jobs_v2') {
      const claimed = jobs.filter((job) => job.status === 'queued');
      for (const job of claimed) Object.assign(job, { status: 'processing', claim_id: `claim-${job.attempts + 1}`,
        attempts: job.attempts + 1, worker_id: body.p_worker_id });
      return Response.json(claimed);
    }
    if (path === '/rest/v1/rpc/finish_connection_job') {
      beforeFinish?.();
      const job = owned(body);
      if (!job) return Response.json(null);
      let status = body.p_status;
      if (['succeeded', 'queued'].includes(status) && connection.status !== 'active') status = 'dead_letter';
      if (status === 'queued' && jobs.some((other) => other.status === 'queued' && other.job_type === job.job_type)) status = 'canceled';
      Object.assign(job, { status, claim_id: null });
      if (status === 'succeeded') {
        Object.assign(connection, body.p_connection_update ?? {});
      }
      if (connection.status === 'active' && connection.expires_at &&
        ((status === 'succeeded' && job.job_type === 'token_refresh') ||
          (job.job_type !== 'token_refresh' && job.refresh_schedule_pending))) {
        job.refresh_schedule_pending = false;
        jobs.push({ ...job, id: 'followup', status: 'queued', job_type: 'token_refresh' });
      }
      if (loseFinishAck) return Response.json({ message: 'lost finish acknowledgement' }, { status: 500 });
      return Response.json(status);
    }
    if (path === '/rest/v1/rpc/begin_connection_job_refresh' || path === '/rest/v1/rpc/begin_connection_refresh') {
      if (path.endsWith('begin_connection_job_refresh') && !owned(body)) return Response.json(null);
      if (connection.status !== 'active' || connection.refresh_lock_id) return Response.json(null);
      connection.refresh_lock_id = body.p_lock_id;
      return Response.json({ connection, credentials: { accessToken: 'access-token', refreshToken, expiresAt: credentialExpiry } });
    }
    if (path === '/rest/v1/rpc/commit_connection_job_refresh' || path === '/rest/v1/rpc/commit_connection_refresh') {
      if (path.endsWith('commit_connection_job_refresh') && !owned(body)) return Response.json('fenced');
      if (connection.status !== 'active' || connection.refresh_lock_id !== body.p_lock_id) return Response.json('fenced');
      refreshToken = body.p_refresh_token;
      Object.assign(connection, { expires_at: body.p_expires_at, refresh_lock_id: null });
      const job = owned(body);
      if (job) job.refresh_schedule_pending = true;
      afterCommit?.();
      return Response.json('committed');
    }
    if (path === '/rest/v1/rpc/fail_connection_job_refresh') {
      if (!owned(body) || connection.refresh_lock_id !== body.p_lock_id) return Response.json(false);
      Object.assign(connection, { status: 'reauth_required', refresh_lock_id: null });
      return Response.json(true);
    }
    if (path === '/rest/v1/rpc/schedule_connection_job_v2') {
      if (connection.status !== 'active' || connection.job_generation !== body.p_generation) return Response.json(null);
      jobs.push({ id: 'scheduled', status: 'queued' });
      return Response.json('scheduled');
    }
    throw new Error(`Unexpected mock endpoint ${request.method} ${path}`);
  };
  const work = () => core.processDueConnectionJobs({ workerId: 'same-worker', limit: 1 });
  try {
    await t.test('normal sync applies metadata only in the fenced completion RPC', async () => {
      reset();
      const result = await work();
      assert.equal(result.processed[0]?.status, 'succeeded');
      assert.equal(connection.display_name, 'Synced');
      assert.equal(audits.at(-1)?.action, 'connection_job.succeeded');
      assert.ok(calls.some(({ body }) => body.p_connection_update?.metadata?.sync?.job_id === 'job'));
    });
    for (const failure of [false, true]) {
      await t.test(`reclaimed same-worker sync cannot ${failure ? 'retry' : 'succeed or write metadata'}`, async () => {
        reset();
        const barrier = blockedSync();
        const working = work();
        await barrier.started;
        Object.assign(jobs[0]!, { claim_id: 'reclaimed', attempts: 2, worker_id: 'same-worker' });
        if (failure) barrier.fail(); else barrier.finish();
        const result = await working;
        assert.deepEqual(result.fenced, ['job']);
        assert.deepEqual(result.processed, []);
        assert.equal(jobs[0]!.claim_id, 'reclaimed');
        assert.equal(jobs[0]!.status, 'processing');
        assert.equal(connection.display_name, 'Original');
        assert.equal(audits.length, 0);
      });
    }
    for (const status of ['revoked', 'active']) {
      await t.test(`${status === 'revoked' ? 'revoke' : 'reconnect'} fences an in-flight sync`, async () => {
        reset();
        const barrier = blockedSync();
        const working = work();
        await barrier.started;
        invalidate(status);
        if (status === 'active') connection.display_name = 'Reconnected';
        barrier.finish();
        assert.deepEqual((await working).fenced, ['job']);
        assert.equal(connection.status, status);
        assert.equal(jobs[0]!.status, 'canceled');
        assert.equal(connection.display_name, status === 'active' ? 'Reconnected' : 'Original');
        assert.equal(audits.length, 0);
      });
    }
    await t.test('reauth becoming required before completion cannot be reactivated by sync', async () => {
      reset(); beforeFinish = () => { connection.status = 'reauth_required'; };
      assert.equal((await work()).processed[0]?.status, 'dead_letter');
      assert.equal(connection.display_name, 'Original');
      assert.equal(connection.status, 'reauth_required');
      assert.equal(audits[0]?.action, 'connection_job.dead_lettered');
    });
    await t.test('ordinary provider failure still retries, and exhausted attempts dead-letter', async () => {
      for (const attempts of [0, 2]) {
        reset('sync_connection', attempts);
        handler.run = async () => { throw new Error('provider failed'); };
        const expected = attempts === 0 ? 'queued' : 'dead_letter';
        assert.equal((await work()).processed[0]?.status, expected);
        assert.equal(jobs[0]!.attempts, attempts + 1);
        assert.equal(jobs[0]!.claim_id, null);
      }
    });
    await t.test('lost finish acknowledgement does not turn committed success into a retry', async () => {
      reset(); loseFinishAck = true;
      await assert.rejects(work());
      assert.equal(jobs[0]!.status, 'succeeded');
      assert.equal(calls.filter(({ path }) => path.endsWith('finish_connection_job')).length, 1);
      assert.equal(audits.length, 0);
    });
    await t.test('refresh success finalizes and schedules atomically, without a second schedule request', async () => {
      reset('token_refresh');
      assert.equal((await work()).processed[0]?.status, 'succeeded');
      assert.equal(refreshToken, 'new-refresh');
      assert.equal(jobs[1]?.id, 'followup');
      assert.ok(calls.some(({ path, body }) => path.endsWith('commit_connection_job_refresh') && body.p_claim_id === 'claim-1'));
      assert.ok(!calls.some(({ path }) => path.endsWith('schedule_connection_job_v2')));
    });
    await t.test('sync that refreshes then fails still atomically schedules its next credential refresh', async () => {
      reset(); credentialExpiry = '2000-01-01T00:00:00Z';
      handler.run = async () => { throw new Error('sync failed after refresh'); };
      assert.equal((await work()).processed[0]?.status, 'queued');
      assert.equal(refreshToken, 'new-refresh');
      assert.equal(jobs[1]?.job_type, 'token_refresh');
      assert.equal(jobs[1]?.status, 'queued');
      assert.ok(!calls.some(({ path }) => path.endsWith('schedule_connection_job_v2')));
    });
    await t.test('cancel after credential commit but before completion cannot recreate a refresh job', async () => {
      reset('token_refresh'); afterCommit = () => invalidate();
      assert.deepEqual((await work()).fenced, ['job']);
      assert.equal(jobs.length, 1);
      assert.equal(connection.status, 'revoked');
    });
    await t.test('refresh reclaimed while provider is in flight cannot commit or fail a newer claim', async () => {
      reset('token_refresh');
      let start!: () => void; let finish!: () => void;
      const started = new Promise<void>((resolve) => { start = resolve; });
      integration.refreshTokens = async () => {
        start();
        return await new Promise((resolve) => { finish = () => resolve({ accessToken: 'stale', refreshToken: 'stale', scopes: [] }); });
      };
      const working = work(); await started;
      jobs[0]!.claim_id = 'reclaimed'; finish();
      assert.deepEqual((await working).fenced, ['job']);
      assert.equal(refreshToken, 'old-refresh');
      assert.equal(connection.status, 'active');
      assert.ok(connection.refresh_lock_id, 'uncertain provider outcome keeps its lease');
    });
    for (const status of ['revoked', 'active']) {
      await t.test(`request-level refresh cannot schedule across a ${status === 'revoked' ? 'revoke' : 'reconnect'}`, async () => {
        reset(); afterCommit = () => invalidate(status);
        await core.forceRefreshConnection('connection');
        const scheduled = calls.find(({ path }) => path.endsWith('schedule_connection_job_v2'));
        assert.equal(scheduled?.body.p_generation, 'generation-1');
        assert.ok(!jobs.some((job) => job.id === 'scheduled'));
        assert.equal(audits.length, 0);
      });
    }
  } finally {
    handler.run = originalSync; integration.refreshTokens = originalRefresh; globalThis.fetch = originalFetch;
  }
});
