import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service',
  GITHUB_CLIENT_ID: 'fake-client-id',
  GITHUB_CLIENT_SECRET: 'fake-client-secret',
  MCP_JWT_SECRET: 'fake-mcp-secret-at-least-thirty-two-bytes',
  WORKER_SHARED_SECRET: 'fake-worker-secret-at-least-thirty-two-bytes',
  OPENAI_API_KEY: ''
});

test('provider refreshes are fenced against concurrent lifecycle changes', async (t) => {
  const originalFetch = globalThis.fetch;
  const connection: Record<string, any> = {};
  const credentialRow: Record<string, any> = {};
  const secrets: Record<string, string> = {};
  let calls: string[] = [];
  let expired = false;
  let loseCommitAck = false;
  let beforeAcquire: (() => void) | undefined;
  let installBody: Record<string, any> | undefined;

  function reset() {
    Object.assign(connection, {
      id: 'test-connection', workspace_id: 'test-workspace', owner_user_id: null, provider: 'github',
      scope: 'workspace', status: 'active', display_name: 'test', external_account_id: 'test-account',
      external_account_email: null, granted_scopes: [], metadata: {}, refresh_lock_id: null,
      connection_key: 'test-workspace:github:workspace:workspace:test-account'
    });
    Object.assign(credentialRow, {
      access_token_secret_id: 'access-id', refresh_token_secret_id: 'refresh-id', api_key_secret_id: null,
      token_type: 'Bearer', expires_at: '2000-01-01T00:00:00Z', version: 1
    });
    Object.assign(secrets, { 'access-id': 'old-access', 'refresh-id': 'old-refresh' });
    calls = [];
    expired = false;
    loseCommitAck = false;
    beforeAcquire = undefined;
    installBody = undefined;
  }
  reset();

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === 'https://github.com/login/oauth/access_token') {
      calls.push('POST fake-github-token');
      return Response.json({ access_token: 'non-expiring-fake-token' });
    }
    if (url.origin !== 'http://supabase.invalid') throw new Error('Unexpected external request');
    calls.push(`${request.method} ${url.pathname}`);
    const body = request.method === 'GET' ? {} : await request.json().catch(() => ({})) as Record<string, any>;
    if (url.pathname === '/rest/v1/connections') {
      if (request.method === 'GET') return Response.json([connection]);
      if (request.method === 'PATCH') {
        const expectedStatus = url.searchParams.get('status');
        if (!expectedStatus || expectedStatus === `eq.${connection.status}`) Object.assign(connection, body);
        return new Response(null, { status: 204 });
      }
    }
    if (url.pathname === '/rest/v1/connection_credentials' && request.method === 'GET') return Response.json([credentialRow]);
    if (url.pathname === '/rest/v1/rpc/resolve_secret') return Response.json(secrets[body.p_secret_id] ?? null);
    if (url.pathname === '/rest/v1/rpc/begin_connection_refresh') {
      beforeAcquire?.();
      if (expired && connection.refresh_lock_id && connection.status === 'active') {
        Object.assign(connection, { status: 'reauth_required', refresh_lock_id: null });
      }
      const acquired = connection.status === 'active' && !connection.refresh_lock_id;
      if (!acquired) return Response.json(null);
      connection.refresh_lock_id = body.p_lock_id;
      return Response.json({
        connection,
        credentials: {
          accessToken: secrets[credentialRow.access_token_secret_id],
          refreshToken: secrets[credentialRow.refresh_token_secret_id],
          apiKey: null,
          tokenType: credentialRow.token_type,
          expiresAt: credentialRow.expires_at
        }
      });
    }
    if (url.pathname === '/rest/v1/rpc/release_connection_refresh_lock') {
      if (connection.refresh_lock_id === body.p_lock_id) connection.refresh_lock_id = null;
      return Response.json(null);
    }
    if (url.pathname === '/rest/v1/rpc/fail_connection_refresh') {
      const marked = connection.status === 'active' && connection.refresh_lock_id === body.p_lock_id;
      if (marked) Object.assign(connection, { status: 'reauth_required', refresh_lock_id: null });
      return Response.json(marked);
    }
    if (url.pathname === '/rest/v1/rpc/commit_connection_refresh') {
      if (connection.status !== 'active' || connection.refresh_lock_id !== body.p_lock_id) return Response.json('fenced');
      if (expired) {
        Object.assign(connection, { status: 'reauth_required', refresh_lock_id: null });
        return Response.json('expired');
      }
      Object.assign(secrets, { 'access-id': body.p_access_token, 'refresh-id': body.p_refresh_token });
      Object.assign(connection, { refresh_lock_id: null, expires_at: body.p_expires_at });
      Object.assign(credentialRow, { expires_at: body.p_expires_at, version: credentialRow.version + 1 });
      if (loseCommitAck) return Response.json({ message: 'simulated lost acknowledgement' }, { status: 500 });
      return Response.json('committed');
    }
    if (url.pathname === '/rest/v1/rpc/install_connection_credentials_v2') {
      installBody = body;
      Object.assign(connection, { status: 'active', refresh_lock_id: null, metadata: body.p_metadata });
      Object.assign(secrets, { 'access-id': body.p_access_token, 'refresh-id': body.p_refresh_token });
      return Response.json({ connection, existing: true, ...(body.p_schedule_refresh && body.p_refresh_token && body.p_expires_at
        ? { refresh_job_id: 'atomic-job', refresh_run_after: '2999-01-01T00:00:00Z' } : {}) });
    }
    if (url.pathname === '/rest/v1/connection_sync_jobs' && request.method === 'PATCH') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/audit_logs' && request.method === 'POST') return new Response(null, { status: 201 });
    throw new Error(`Unexpected mock request: ${request.method} ${url.pathname}`);
  };

  const core = await import('../packages/core/src/connections');
  const { getIntegration } = await import('../packages/integrations/src/index');
  const integration = getIntegration('github');
  assert.ok(integration);
  const originalRefresh = integration.refreshTokens;
  const result = { accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh', scopes: [], expiresAt: null };
  const revoke = () => core.revokeConnection({ workspaceId: 'test-workspace', connectionId: 'test-connection', actorUserId: 'test-user' });
  const install = () => core.upsertInstalledConnection({
    workspaceId: 'test-workspace', ownerUserId: null, provider: 'github', scope: 'workspace',
    externalAccountId: 'test-account', externalAccountEmail: null, displayName: 'test', grantedScopes: [],
    credentials: { accessToken: 'reconnected-access', refreshToken: 'reconnected-refresh', scopes: [], expiresAt: null }
  });
  function blockedRefresh() {
    let start!: () => void;
    let finish!: (value: typeof result) => void;
    let fail!: (error: Error) => void;
    let sentToken: string | undefined;
    const started = new Promise<void>((resolve) => { start = resolve; });
    integration!.refreshTokens = async ({ refreshToken }) => {
      sentToken = refreshToken;
      start();
      return await new Promise<typeof result>((resolve, reject) => { finish = resolve; fail = reject; });
    };
    return { started, sentToken: () => sentToken, finish: () => finish(result), fail: () => fail(new Error('provider error with secret')) };
  }

  try {
    for (const enabled of [true, false]) {
      await t.test(`install ${enabled ? 'enables' : 'disables'} atomic refresh scheduling`, async () => {
        reset();
        await core.upsertInstalledConnection({
          workspaceId: 'test-workspace', ownerUserId: null, provider: 'github', scope: 'workspace',
          externalAccountId: 'test-account', externalAccountEmail: null, displayName: 'test', grantedScopes: [],
          credentials: { accessToken: 'access', refreshToken: 'refresh', expiresAt: '2999-01-01T00:00:00Z', scopes: [] },
          scheduleTokenRefreshJob: enabled
        });
        assert.equal(installBody?.p_schedule_refresh, enabled);
        assert.ok(!calls.includes('POST /rest/v1/rpc/schedule_connection_job_v2'));
      });
    }
    await t.test('a successful late refresh cannot reactivate a revoked connection', async () => {
      reset();
      const barrier = blockedRefresh();
      const refreshing = core.forceRefreshConnection('test-connection');
      await barrier.started;
      await revoke();
      barrier.finish();
      await assert.rejects(refreshing, /did not finish safely/);
      assert.equal(connection.status, 'revoked');
      assert.equal(secrets['refresh-id'], 'old-refresh');
      assert.ok(!calls.some((call) => /delete_secret|revoke_token/.test(call)));
    });

    await t.test('a failed late refresh does not overwrite a revoked connection', async () => {
      reset();
      const barrier = blockedRefresh();
      const refreshing = core.forceRefreshConnection('test-connection');
      await barrier.started;
      await revoke();
      barrier.fail();
      await assert.rejects(refreshing, (error: Error) => !error.message.includes('secret'));
      assert.equal(connection.status, 'revoked');
    });

    await t.test('a late refresh cannot overwrite an explicit reconnect', async () => {
      reset();
      const barrier = blockedRefresh();
      const refreshing = core.forceRefreshConnection('test-connection');
      await barrier.started;
      await install();
      assert.equal(barrier.sentToken(), 'old-refresh');
      barrier.finish();
      await assert.rejects(refreshing, /did not finish safely/);
      assert.equal(connection.status, 'active');
      assert.equal(secrets['refresh-id'], 'reconnected-refresh');
    });

    await t.test('a late refresh failure cannot overwrite an explicit reconnect', async () => {
      reset();
      const barrier = blockedRefresh();
      const refreshing = core.forceRefreshConnection('test-connection');
      await barrier.started;
      await install();
      barrier.fail();
      await assert.rejects(refreshing, /did not finish safely/);
      assert.equal(connection.status, 'active');
      assert.equal(secrets['refresh-id'], 'reconnected-refresh');
    });

    await t.test('lock contention fails rather than returning stale credentials', async () => {
      reset();
      connection.refresh_lock_id = 'someone-else';
      integration.refreshTokens = async () => { throw new Error('must not refresh'); };
      await assert.rejects(core.forceRefreshConnection('test-connection'), /already in progress/);
      assert.ok(!calls.includes('GET /rest/v1/connection_credentials'));
    });

    await t.test('credentials are reloaded after acquiring the lock', async () => {
      reset();
      beforeAcquire = () => {
        secrets['access-id'] = 'already-refreshed';
        credentialRow.expires_at = '2999-01-01T00:00:00Z';
      };
      integration.refreshTokens = async () => { throw new Error('must not refresh'); };
      const fresh = await core.refreshConnectionIfNeeded(connection as any, {
        accessToken: 'stale', refreshToken: 'stale-refresh', expiresAt: '2000-01-01T00:00:00Z'
      });
      assert.equal(fresh.accessToken, 'already-refreshed');
      assert.equal(connection.refresh_lock_id, null);
    });

    await t.test('a GitHub token without refresh credentials retains existing behavior near its synthetic expiry', async () => {
      reset();
      const tokens = await integration.exchangeAuthorizationCode({ code: 'fake-code', redirectUri: 'http://localhost/callback' });
      assert.equal(tokens.refreshToken, null);
      assert.ok(tokens.expiresAt);
      const realNow = Date.now;
      Date.now = () => realNow() + 56 * 60 * 1000;
      try {
        const credentials = await core.refreshConnectionIfNeeded(connection as any, tokens);
        assert.equal(credentials.accessToken, 'non-expiring-fake-token');
        assert.ok(!calls.includes('POST /rest/v1/rpc/begin_connection_refresh'));
      } finally {
        Date.now = realNow;
      }
    });

    await t.test('an expired lease rejects late results and requires reconnect', async () => {
      reset();
      const barrier = blockedRefresh();
      const refreshing = core.forceRefreshConnection('test-connection');
      await barrier.started;
      expired = true;
      barrier.finish();
      await assert.rejects(refreshing, /did not finish safely/);
      assert.equal(connection.status, 'reauth_required');
      assert.equal(secrets['refresh-id'], 'old-refresh');
      await assert.rejects(core.forceRefreshConnection('test-connection'), /not active/);
    });

    await t.test('an expired in-flight lease cannot be stolen for a second refresh', async () => {
      reset();
      const barrier = blockedRefresh();
      const refreshing = core.forceRefreshConnection('test-connection');
      await barrier.started;
      expired = true;
      await assert.rejects(core.forceRefreshConnection('test-connection'), /already in progress/);
      barrier.finish();
      await assert.rejects(refreshing, /did not finish safely/);
      assert.equal(connection.status, 'reauth_required');
      assert.equal(secrets['refresh-id'], 'old-refresh');
    });

    await t.test('a malformed provider response cannot preserve stale credentials as fresh', async () => {
      reset();
      integration.refreshTokens = async () => ({ ...result, accessToken: '', refreshToken: 'rotated-but-uncertain' });
      await assert.rejects(core.forceRefreshConnection('test-connection'), /did not finish safely/);
      assert.equal(connection.status, 'reauth_required');
      assert.equal(secrets['refresh-id'], 'old-refresh');
      assert.ok(!calls.includes('POST /rest/v1/rpc/commit_connection_refresh'));
    });

    await t.test('a lost commit acknowledgement does not revert a committed rotation', async () => {
      reset();
      loseCommitAck = true;
      integration.refreshTokens = async () => ({ ...result, expiresAt: '2999-01-01T00:00:00Z' });
      await assert.rejects(core.forceRefreshConnection('test-connection', { scheduleNextJob: false }), /did not finish safely/);
      assert.equal(connection.status, 'active');
      assert.equal(secrets['refresh-id'], 'refreshed-refresh');
      loseCommitAck = false;
      integration.refreshTokens = async () => { throw new Error('must not refresh again'); };
      const fresh = await core.refreshConnectionIfNeeded(connection as any, {
        accessToken: 'stale', refreshToken: 'stale-refresh', expiresAt: '2000-01-01T00:00:00Z'
      });
      assert.equal(fresh.accessToken, 'refreshed-access');
    });
  } finally {
    integration.refreshTokens = originalRefresh;
    globalThis.fetch = originalFetch;
  }
});
