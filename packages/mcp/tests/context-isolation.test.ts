import assert from 'node:assert/strict';
import { test } from 'node:test';

test('search, MCP resources, and MCP tools carry the authenticated context owner', async () => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    MCP_JWT_SECRET: 'test-mcp-secret-at-least-thirty-two-bytes',
    WORKER_SHARED_SECRET: 'test-worker-secret-at-least-thirty-two-bytes',
    OPENAI_API_KEY: 'test-embedding-key'
  });

  const requests: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/embeddings') {
      return Response.json({ data: [{ embedding: [1, 0] }] });
    }
    if (url.origin !== 'http://supabase.invalid') throw new Error(`Unexpected network request: ${url.origin}`);
    if (url.pathname === '/rest/v1/rpc/match_context_chunks') {
      const body = await request.json() as Record<string, unknown>;
      requests.push(body);
      const actor = body.p_actor_user_id;
      const rows = body.p_workspace_id === 'workspace-a' && (actor === 'member' || actor === 'owner')
        ? [
            { chunk_id: 'shared', asset_id: 'shared', title: 'Shared', content: 'shared context', similarity: 1, metadata: {} },
            { chunk_id: String(actor), asset_id: String(actor), title: String(actor), content: `${actor} private context`, similarity: 1, metadata: {} }
          ]
        : [];
      return Response.json(rows);
    }
    if (url.pathname === '/rest/v1/rpc/consume_rate_limit') {
      return Response.json({ allowed: true, remaining: 59, count: 1 });
    }
    if (url.pathname === '/rest/v1/prompt_templates') {
      return Response.json([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Shared prompt', description: null, content: 'shared prompt', owner_user_id: null }]);
    }
    if (url.pathname === '/rest/v1/connections') {
      return Response.json([{ id: 'connection-1', workspace_id: 'workspace-a', provider: 'github', scope: 'workspace', status: 'active', owner_user_id: null, granted_scopes: [] }]);
    }
    if (url.pathname === '/rest/v1/connection_credentials' || url.pathname === '/rest/v1/context_bindings') {
      return Response.json([]);
    }
    if (url.pathname === '/rest/v1/tool_invocations' || url.pathname === '/rest/v1/audit_logs') {
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected mock request: ${request.method} ${url.pathname}`);
  };

  try {
    const { matchContextChunks, resolveContextInjection } = await import('@plusmy/core');
    const { getIntegration } = await import('@plusmy/integrations');
    const { handleMcpJsonRpcRequest } = await import('../src/server');

    const directMatches = await matchContextChunks('workspace-a', 'member', 'search terms');
    assert.deepEqual(directMatches.map((match) => match.content), ['shared context', 'member private context']);
    assert.equal(requests.at(-1)?.p_actor_user_id, 'member');
    assert.equal(requests.at(-1)?.p_workspace_id, 'workspace-a');

    const beforeAnonymous = requests.length;
    assert.deepEqual((await resolveContextInjection('workspace-a', null, ['search terms'])).matches, []);
    assert.equal(requests.length, beforeAnonymous);
    assert.deepEqual(await matchContextChunks('workspace-a', 'outsider', 'search terms'), []);

    const auth = { sub: 'member', userId: 'member', workspaceId: 'workspace-a', clientId: 'client', scopes: ['mcp:resources', 'mcp:tools'] };
    const resource = await handleMcpJsonRpcRequest(auth, {
      jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'plusmy://prompt/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    });
    assert.equal(requests.at(-1)?.p_actor_user_id, 'member');
    assert.match(JSON.stringify(resource.response.result), /member private context/);
    assert.doesNotMatch(JSON.stringify(resource.response.result), /owner private context/);

    const integration = getIntegration('github');
    assert.ok(integration);
    const originalListTools = integration.listTools;
    const originalCallTool = integration.callTool;
    integration.listTools = async () => [{ name: 'github.test', title: 'Test', description: 'Mock only', inputSchema: { type: 'object', properties: {} }, requiredProviderScopes: [] }];
    integration.callTool = async () => ({ ok: true });
    try {
      const tool = await handleMcpJsonRpcRequest(auth, {
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'github.test', arguments: {} }
      });
      assert.equal(requests.at(-1)?.p_actor_user_id, 'member');
      assert.match(JSON.stringify(tool.response.result), /member private context/);
      assert.doesNotMatch(JSON.stringify(tool.response.result), /owner private context/);
      assert.equal(tool.response.error, undefined);
    } finally {
      integration.listTools = originalListTools;
      integration.callTool = originalCallTool;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
