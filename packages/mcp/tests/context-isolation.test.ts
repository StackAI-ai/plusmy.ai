import assert from 'node:assert/strict';
import { test } from 'node:test';

test('context search, health, overview, and MCP paths preserve personal visibility', async () => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    MCP_JWT_SECRET: 'test-mcp-secret-at-least-thirty-two-bytes',
    WORKER_SHARED_SECRET: 'test-worker-secret-at-least-thirty-two-bytes',
    OPENAI_API_KEY: 'test-embedding-key'
  });

  const requests: Array<Record<string, unknown>> = [];
  const auditRecords: unknown[] = [];
  let privateOnlyEmbedded = false;
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
            { chunk_id: String(actor), asset_id: String(actor), title: `${actor} private title`, content: `${actor} private context`, similarity: 1, metadata: {} }
          ]
        : [];
      return Response.json(rows);
    }
    if (url.pathname === '/rest/v1/rpc/consume_rate_limit') {
      return Response.json({ allowed: true, remaining: 59, count: 1 });
    }
    if (url.pathname === '/rest/v1/rpc/context_vector_index_health') {
      return Response.json([{ index_name: 'context_asset_chunks_embedding_idx', index_present: true, index_status: 'healthy' }]);
    }
    if (url.pathname === '/rest/v1/workspace_members') {
      return Response.json(url.searchParams.get('user_id') === 'eq.member' ? [{ user_id: 'member' }] : []);
    }
    if (url.pathname === '/rest/v1/prompt_templates') {
      const shared = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Shared prompt', description: null, content: 'shared prompt', owner_user_id: null };
      return Response.json(url.searchParams.has('id') ? [shared] : [shared, { id: 'member-prompt', owner_user_id: 'member' }, { id: 'owner-prompt', owner_user_id: 'owner' }]);
    }
    if (url.pathname === '/rest/v1/skill_definitions') {
      return Response.json([{ id: 'shared-skill', owner_user_id: null }, { id: 'member-skill', owner_user_id: 'member' }, { id: 'owner-skill', owner_user_id: 'owner' }]);
    }
    if (url.pathname === '/rest/v1/context_assets') {
      return Response.json([{ id: 'shared', owner_user_id: null, metadata: {} }, { id: 'member', owner_user_id: 'member', metadata: {} }, { id: 'owner', owner_user_id: 'owner', metadata: {} }]);
    }
    if (url.pathname === '/rest/v1/context_asset_chunks') {
      return Response.json([
        { asset_id: 'shared', metadata: { embedded: !privateOnlyEmbedded }, created_at: '2020-01-01T00:00:00Z' },
        { asset_id: 'member', metadata: { embedded: !privateOnlyEmbedded }, created_at: '2021-01-01T00:00:00Z' },
        { asset_id: 'owner', metadata: { embedded: true }, created_at: '2029-01-01T00:00:00Z' }
      ]);
    }
    if (url.pathname === '/rest/v1/connections') {
      return Response.json([
        { id: 'connection-1', workspace_id: 'workspace-a', provider: 'github', scope: 'workspace', status: 'active', owner_user_id: null, granted_scopes: [] },
        { id: 'member-connection', provider: 'slack', scope: 'personal', status: 'active', owner_user_id: 'member', granted_scopes: [] },
        { id: 'owner-connection', provider: 'slack', scope: 'personal', status: 'active', owner_user_id: 'owner', granted_scopes: [] }
      ]);
    }
    if (url.pathname === '/rest/v1/context_bindings' && request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': '0-1/2' } });
    }
    if (url.pathname === '/rest/v1/connection_credentials' || url.pathname === '/rest/v1/context_bindings') {
      return Response.json([]);
    }
    if (url.pathname === '/rest/v1/audit_logs') {
      auditRecords.push(await request.json());
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/tool_invocations') {
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected mock request: ${request.method} ${url.pathname}`);
  };

  try {
    const { getContextEmbeddingHealth, getWorkspaceOverview, matchContextChunks, resolveContextInjection } = await import('@plusmy/core');
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

    const health = await getContextEmbeddingHealth('workspace-a', 'member');
    assert.equal(health.totalAssets, 2);
    assert.equal(health.totalChunks, 2);
    assert.equal(health.embeddedChunks, 2);
    assert.equal(health.lastEmbeddedAt, '2021-01-01T00:00:00Z');
    privateOnlyEmbedded = true;
    const emptyHealth = await getContextEmbeddingHealth('workspace-a', 'member');
    assert.equal(emptyHealth.embeddedChunks, 0);
    assert.equal(emptyHealth.lastEmbeddedAt, null);
    assert.equal(emptyHealth.embeddingIndexStatus, 'stale');
    await assert.rejects(getContextEmbeddingHealth('workspace-a', 'outsider'), /membership is required/);
    assert.deepEqual(await getWorkspaceOverview('workspace-a', 'member'), {
      connections: 2, prompts: 2, skills: 2, assets: 2, bindings: 2, userId: 'member'
    });

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
      assert.ok(auditRecords.length > 0);
      assert.doesNotMatch(JSON.stringify(auditRecords), /member private title/);
    } finally {
      integration.listTools = originalListTools;
      integration.callTool = originalCallTool;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
