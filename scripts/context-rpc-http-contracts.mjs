import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

test('local PostgREST routes context RPCs without exposing actor selection to anon', async () => {
  const apiUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (apiUrl.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(apiUrl.hostname)) {
    throw new Error('Context RPC contracts require a disposable loopback Supabase instance.');
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!serviceKey || !anonKey) throw new Error('Local Supabase test keys are required.');

  const vector = Array(1536).fill(0);
  vector[0] = 1;
  const workspace = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const owner = '11111111-1111-1111-1111-111111111111';
  const legacy = { p_workspace_id: workspace, p_query_embedding: vector, p_limit: 8, p_filters: {} };
  const actor = { ...legacy, p_actor_user_id: owner };

  async function rpc(key, body) {
    const response = await fetch(new URL('/rest/v1/rpc/match_context_chunks', apiUrl), {
      method: 'POST',
      redirect: 'error',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'content-profile': 'app'
      },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  const actorResult = await rpc(serviceKey, actor);
  assert.equal(actorResult.status, 200, `actor RPC failed: ${JSON.stringify(actorResult.body)}`);
  assert.ok(Array.isArray(actorResult.body));
  const legacyResult = await rpc(serviceKey, legacy);
  assert.equal(legacyResult.status, 200, `legacy RPC failed: ${JSON.stringify(legacyResult.body)}`);
  assert.ok(Array.isArray(legacyResult.body));
  assert.ok([401, 403, 404].includes((await rpc(anonKey, actor)).status), 'anon must not invoke the actor RPC');
  assert.ok([401, 403, 404].includes((await rpc(anonKey, legacy)).status), 'anon must not invoke the legacy RPC');

  const require = createRequire(new URL('../packages/supabase/package.json', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const service = createClient(apiUrl.toString(), serviceKey, options);
  const anon = createClient(apiUrl.toString(), anonKey, options);
  const summaryArgs = { p_workspace_id: workspace, p_actor_user_id: owner };
  const summary = await service.schema('app').rpc('context_embedding_summary', summaryArgs).maybeSingle();
  assert.equal(summary.error, null, JSON.stringify(summary.error));
  assert.ok(summary.data);
  for (const key of ['total_assets', 'system_managed_assets', 'total_chunks', 'embedded_chunks']) {
    assert.ok(Number.isSafeInteger(summary.data[key]) && summary.data[key] >= 0, `${key} must be a count`);
  }
  assert.ok(summary.data.last_embedded_at === null || typeof summary.data.last_embedded_at === 'string');
  const outsider = await service.schema('app').rpc('context_embedding_summary', {
    ...summaryArgs,
    p_actor_user_id: '00000000-0000-4000-8000-000000000000'
  }).maybeSingle();
  assert.equal(outsider.error, null, JSON.stringify(outsider.error));
  assert.equal(outsider.data, null, 'non-members must not receive an aggregate');
  const denied = await anon.schema('app').rpc('context_embedding_summary', summaryArgs).maybeSingle();
  assert.ok(denied.error, 'anon must not select an actor for the summary');
});
