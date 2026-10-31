import assert from 'node:assert/strict';
import { test } from 'node:test';

test('local PostgREST routes the actor and legacy search RPCs without exposing them to anon', async () => {
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
  const outsider = '44444444-4444-4444-4444-444444444444';
  const legacy = { p_workspace_id: workspace, p_query_embedding: JSON.stringify(vector), p_limit: 8, p_filters: {} };
  const actor = { ...legacy, p_actor_user_id: owner };

  async function rpc(key, body) {
    const response = await fetch(new URL('/rest/v1/rpc/match_context_chunks', apiUrl), {
      method: 'POST',
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
  const outsiderResult = await rpc(serviceKey, { ...actor, p_actor_user_id: outsider });
  assert.equal(outsiderResult.status, 200, `outsider RPC failed: ${JSON.stringify(outsiderResult.body)}`);
  assert.deepEqual(outsiderResult.body, []);
  assert.ok([401, 403, 404].includes((await rpc(anonKey, actor)).status), 'anon must not invoke the actor RPC');
  assert.ok([401, 403, 404].includes((await rpc(anonKey, legacy)).status), 'anon must not invoke the legacy RPC');
});
