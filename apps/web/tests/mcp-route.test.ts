import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function assertSecurityHeaders(response: Response, origin?: string) {
  assert.equal(response.headers.get('access-control-allow-origin'), origin ?? null);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('vary')?.split(',').map((value) => value.trim().toLowerCase()).includes('origin'));
  if (origin) assert.ok(response.headers.get('access-control-expose-headers')?.includes('WWW-Authenticate'));
}

test('MCP route guards Origin before auth and preserves stateless HTTP contracts', async (t) => {
  let approvalActive = true;
  let databaseRequests = 0;
  let rateLimitRequests = 0;
  const envKeys = [
    'APP_URL', 'MCP_ALLOWED_ORIGINS', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY', 'MCP_JWT_SECRET', 'WORKER_SHARED_SECRET', 'OPENAI_API_KEY'
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path.startsWith('/rest/v1/')) databaseRequests++;
    response.setHeader('content-type', 'application/json');
    if (path === '/rest/v1/workspace_members') {
      response.end(JSON.stringify([{ workspace_id: 'workspace-1' }]));
    } else if (path === '/rest/v1/oauth_client_approvals') {
      response.end(JSON.stringify([{ status: approvalActive ? 'active' : 'revoked', revoked_at: null, scopes: ['mcp:tools', 'mcp:resources'] }]));
    } else if (path === '/rest/v1/prompt_templates') {
      response.end(JSON.stringify([{
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Shared instructions',
        description: 'Workspace prompt', content: 'Shared configuration for AI clients.', owner_user_id: null
      }]));
    } else if (path === '/rest/v1/rpc/consume_rate_limit') {
      rateLimitRequests++;
      response.end(JSON.stringify({ allowed: false, remaining: 0, count: 121 }));
    } else if (path.startsWith('/rest/v1/')) {
      response.end('[]');
    } else {
      response.writeHead(404).end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    Object.assign(process.env, {
      APP_URL: 'http://localhost:3009',
      MCP_ALLOWED_ORIGINS: 'https://approved-client.example, https://second-client.example:8443',
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'disposable-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'disposable-service-key',
      MCP_JWT_SECRET: 'disposable-mcp-secret-at-least-thirty-two-bytes',
      WORKER_SHARED_SECRET: 'disposable-worker-secret-at-least-thirty-two-bytes',
      OPENAI_API_KEY: ''
    });

    const { NextRequest } = await import('next/server');
    const { issueMcpAccessToken } = await import('../../../packages/core/src/auth-context');
    const { GET, POST, OPTIONS, HEAD, PUT, PATCH, DELETE } = await import('../app/mcp/route');
    const token = await issueMcpAccessToken({
      sub: 'user-1', clientId: 'client-1', workspaceId: 'workspace-1', userId: 'user-1',
      scopes: ['mcp:tools', 'mcp:resources']
    });
    const post = (body: string, authorization = `Bearer ${token}`, headers: Record<string, string> = {}, url = 'http://localhost:3009/mcp') => POST(new NextRequest(url, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json', ...headers }, body
    }));
    const requestFor = (method: string, origin?: string) => new NextRequest('http://localhost:3009/mcp', {
      method, headers: origin === undefined ? {} : { origin }
    });

    const initialized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });

    await t.test('rejects hostile, malformed and spoofed origins without auth, body reads or dispatch', async () => {
      const before = databaseRequests;
      let bodyReads = 0;
      for (const origin of [
        '', 'null', '*', 'https://evil.example', 'https://*.example', 'https://approved-client.example.evil',
        'http://approved-client.example', 'https://approved-client.example:8443', 'https://APPROVED-client.example',
        'https://approved-client.example/', 'https://approved-client.example/path',
        'https://user:password@approved-client.example', 'https://approved-client.example#fragment',
        'https://approved-client.example?token=secret', 'file:///', 'not a URL',
        'http://localhost:3009, https://approved-client.example', 'http://localhost:3009 https://approved-client.example'
      ]) {
        const request = new NextRequest('https://evil.example/mcp', {
          method: 'POST', headers: {
            origin, authorization: `Bearer ${token}`, host: 'evil.example',
            'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https',
            forwarded: 'host=evil.example;proto=https'
          }, body: '{'
        });
        request.json = async () => { bodyReads++; throw new Error('Rejected bodies must not be parsed.'); };
        const rejected = await POST(request);
        assert.equal(rejected.status, 403, origin);
        assertSecurityHeaders(rejected);
        assert.equal(rejected.headers.get('www-authenticate'), null);
        assert.equal(rejected.headers.get('access-control-expose-headers'), null);
        assert.deepEqual(await rejected.json(), { error: 'forbidden', error_description: 'Origin is not allowed.' });
      }
      const duplicateOrigins = requestFor('POST');
      duplicateOrigins.headers.append('origin', 'http://localhost:3009');
      duplicateOrigins.headers.append('origin', 'https://approved-client.example');
      assert.equal((await POST(duplicateOrigins)).status, 403);
      const hostileWithoutToken = await post(initialized, '', { origin: 'https://evil.example' });
      assert.equal(hostileWithoutToken.status, 403);
      assert.equal(bodyReads, 0);
      assert.equal(databaseRequests, before);
    });

    await t.test('validates OPTIONS and all unsupported methods before authentication', async () => {
      const before = databaseRequests;
      for (const origin of [undefined, 'http://localhost:3009', 'https://approved-client.example', 'https://second-client.example:8443']) {
        const preflight = requestFor('OPTIONS', origin);
        preflight.headers.set('access-control-request-method', 'POST');
        preflight.headers.set('access-control-request-headers', 'authorization, content-type, mcp-protocol-version');
        const response = await OPTIONS(preflight);
        assert.equal(response.status, 204);
        assert.equal(await response.text(), '');
        assertSecurityHeaders(response, origin);
        assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
        assert.equal(response.headers.get('www-authenticate'), null);
        if (origin) assert.equal(response.headers.get('access-control-allow-headers'), 'Authorization, Content-Type, MCP-Protocol-Version');
        for (const [method, handler] of Object.entries({ GET, HEAD, PUT, PATCH, DELETE })) {
          const result = await handler(requestFor(method, origin));
          assert.equal(result.status, 405);
          assertSecurityHeaders(result, origin);
          assert.equal(result.headers.get('allow'), 'POST, OPTIONS');
        }
      }
      for (const origin of ['https://evil.example', 'null', '', 'http://localhost:3009/']) {
        for (const [method, handler] of Object.entries({ GET, HEAD, PUT, PATCH, DELETE, OPTIONS })) {
          const response = await handler(requestFor(method, origin));
          assert.equal(response.status, 403);
          assertSecurityHeaders(response);
          assert.equal(response.headers.get('access-control-allow-methods'), null);
          assert.equal(response.headers.get('access-control-allow-headers'), null);
        }
      }
      const extraHeaders = requestFor('OPTIONS', 'https://approved-client.example');
      extraHeaders.headers.set('access-control-request-method', 'DELETE');
      extraHeaders.headers.set('access-control-request-headers', 'X-Attacker');
      extraHeaders.headers.set('access-control-request-private-network', 'true');
      const fixedPreflight = await OPTIONS(extraHeaders);
      assert.equal(fixedPreflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
      assert.equal(fixedPreflight.headers.get('access-control-allow-headers')?.includes('X-Attacker'), false);
      assert.equal(fixedPreflight.headers.get('access-control-allow-private-network'), null);
      assert.equal(databaseRequests, before);
    });

    await t.test('accepts canonical, exact configured and absent origins; does not trust Host for challenges', async () => {
      for (const origin of [undefined, 'http://localhost:3009', 'https://approved-client.example', 'https://second-client.example:8443']) {
        const headers: Record<string, string> = { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' };
        if (origin !== undefined) headers.origin = origin;
        const unauthorized = await post(initialized, '', headers, 'https://evil.example/mcp');
        assert.equal(unauthorized.status, 401);
        assertSecurityHeaders(unauthorized, origin);
        assert.equal(unauthorized.headers.get('www-authenticate'), 'Bearer realm="plusmy.ai", resource_metadata="http://localhost:3009/.well-known/oauth-protected-resource"');
        const invalidToken = await post(initialized, 'Bearer invalid', headers);
        assert.equal(invalidToken.status, 401);
        assertSecurityHeaders(invalidToken, origin);
        const notification = await post(initialized, undefined, headers);
        assert.equal(notification.status, 202);
        assert.equal(await notification.text(), '');
        assertSecurityHeaders(notification, origin);
        const malformed = await post('{', undefined, headers);
        assert.equal(malformed.status, 400);
        assertSecurityHeaders(malformed, origin);
        assert.equal((await malformed.json()).error.code, -32700);
        const ping = await post(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }), undefined, headers);
        assert.equal(ping.status, 200);
        assertSecurityHeaders(ping, origin);
        assert.deepEqual(await ping.json(), { jsonrpc: '2.0', id: 9, result: {} });
      }
    });

    await t.test('fails closed for missing or invalid configuration without exposing values', async () => {
      const before = databaseRequests;
      const invalidConfigs = [
        { APP_URL: undefined, MCP_ALLOWED_ORIGINS: '' },
        { APP_URL: 'not a URL', MCP_ALLOWED_ORIGINS: '' },
        { APP_URL: 'https://config-user:config-secret@app.example', MCP_ALLOWED_ORIGINS: '' },
        ...['*', 'null', 'https://client.example/', 'https://approved-client.example,'].map((MCP_ALLOWED_ORIGINS) => ({ APP_URL: 'http://localhost:3009', MCP_ALLOWED_ORIGINS }))
      ];
      try {
        for (const config of invalidConfigs) {
          if (config.APP_URL === undefined) delete process.env.APP_URL;
          else process.env.APP_URL = config.APP_URL;
          process.env.MCP_ALLOWED_ORIGINS = config.MCP_ALLOWED_ORIGINS;
          for (const origin of [undefined, 'http://localhost:3009', 'https://evil.example']) {
            for (const [method, handler] of Object.entries({ POST, GET, HEAD, PUT, PATCH, DELETE, OPTIONS })) {
              const response = await handler(requestFor(method, origin));
              assert.equal(response.status, 503);
              assertSecurityHeaders(response);
              assert.equal(response.headers.get('www-authenticate'), null);
              assert.deepEqual(await response.json(), { error: 'temporarily_unavailable', error_description: 'MCP origin policy is not configured.' });
            }
          }
        }
      } finally {
        process.env.APP_URL = 'http://localhost:3009';
        process.env.MCP_ALLOWED_ORIGINS = 'https://approved-client.example, https://second-client.example:8443';
      }
      assert.equal(databaseRequests, before);
    });

    await t.test('preserves and exposes rate-limit headers for allowed browsers', async () => {
      for (const origin of [undefined, 'https://approved-client.example']) {
        const before = rateLimitRequests;
        const response = await post(JSON.stringify({ jsonrpc: '2.0', id: 'limited', method: 'tools/call', params: { name: 'slack.post_message', arguments: {} } }),
          undefined, origin ? { origin } : {});
        assert.equal(response.status, 200);
        assertSecurityHeaders(response, origin);
        assert.equal(rateLimitRequests, before + 1);
        assert.equal((await response.json()).error.code, -32000);
        assert.equal(response.headers.get('ratelimit-limit'), '60');
        assert.equal(response.headers.get('ratelimit-remaining'), '0');
        assert.equal(response.headers.get('ratelimit-reset'), '60');
        assert.equal(response.headers.get('x-ratelimit-limit'), '60');
        assert.equal(response.headers.get('x-ratelimit-remaining'), '0');
        assert.ok(Number(response.headers.get('x-ratelimit-reset')) >= Math.floor(Date.now() / 1000));
        if (origin) {
          for (const name of ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
            assert.ok(response.headers.get('access-control-expose-headers')?.split(', ').includes(name));
          }
        }
      }
    });

    const unauthorized = await post(initialized, '');
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate') ?? '', /oauth-protected-resource/);
    assertSecurityHeaders(unauthorized);
    const notification = await post(initialized);
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), '');

    const initialize = await post(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    }));
    assert.equal(initialize.status, 200);
    assert.equal((await initialize.json()).result.protocolVersion, '2025-03-26');
    const invalidInitialize = await post(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }));
    assert.equal((await invalidInitialize.json()).error.code, -32602);

    const batch = await post(JSON.stringify([
      { jsonrpc: '2.0', id: 'ping', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: null, method: 'ping' }
    ]));
    assert.equal(batch.status, 200);
    assert.deepEqual(await batch.json(), [
      { jsonrpc: '2.0', id: 'ping', result: {} },
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } }
    ]);
    const malformed = await post('{');
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, -32700);
    assert.equal((await GET(requestFor('GET'))).status, 405);

    const observedMethods: string[] = [];
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3009/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) => {
        const request = new NextRequest(input, init ? { ...init, signal: init.signal ?? undefined } : undefined);
        if (request.method === 'GET') return GET(request);
        if (request.method !== 'POST') return new Response(null, { status: 405 });
        const message = await request.clone().json();
        observedMethods.push(message.method);
        return POST(request);
      }
    });
    const client = new Client({ name: 'plusmy-contract-client', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(transport);
      assert.equal(transport.protocolVersion, '2025-03-26');
      assert.equal(client.getServerVersion()?.name, 'plusmy.ai');
      assert.ok(observedMethods.includes('notifications/initialized'));
      const resources = await client.listResources();
      const uri = 'plusmy://prompt/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      assert.ok(resources.resources.some((resource) => resource.uri === uri));
      const resource = await client.readResource({ uri });
      assert.ok(resource.contents[0] && 'text' in resource.contents[0]);
      assert.equal(resource.contents[0].text, 'Shared configuration for AI clients.');
      assert.deepEqual((await client.listTools()).tools, []);
    } finally {
      await client.close();
    }

    approvalActive = false;
    assert.equal((await post(initialized)).status, 401);
    const revoked = await post(initialized, undefined, { origin: 'https://approved-client.example' });
    assert.equal(revoked.status, 401);
    assertSecurityHeaders(revoked, 'https://approved-client.example');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
