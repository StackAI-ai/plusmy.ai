import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('MCP route authenticates and accepts a standard stateless HTTP handshake', async () => {
  let approvalActive = true;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
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
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'disposable-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'disposable-service-key',
      MCP_JWT_SECRET: 'disposable-mcp-secret-at-least-thirty-two-bytes',
      WORKER_SHARED_SECRET: 'disposable-worker-secret-at-least-thirty-two-bytes',
      OPENAI_API_KEY: ''
    });

    const { NextRequest } = await import('next/server');
    const { issueMcpAccessToken } = await import('../../../packages/core/src/auth-context');
    const { GET, POST } = await import('../app/mcp/route');
    const token = await issueMcpAccessToken({
      sub: 'user-1', clientId: 'client-1', workspaceId: 'workspace-1', userId: 'user-1',
      scopes: ['mcp:tools', 'mcp:resources']
    });
    const post = (body: string, authorization = `Bearer ${token}`) => POST(new NextRequest('http://localhost:3009/mcp', {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body
    }));

    const initialized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const unauthorized = await post(initialized, '');
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate') ?? '', /oauth-protected-resource/);
    assert.equal(unauthorized.headers.get('access-control-expose-headers'), 'WWW-Authenticate');
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
    assert.equal((await GET()).status, 405);

    const observedMethods: string[] = [];
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3009/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) => {
        const request = new NextRequest(input, init ? { ...init, signal: init.signal ?? undefined } : undefined);
        if (request.method === 'GET') return GET();
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
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
