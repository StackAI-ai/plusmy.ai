import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestConnectionSync } from '../app/connections/sync-request';

test('sync request reports a queued job and sends the selected identifiers', async () => {
  const result = await requestConnectionSync('workspace', 'connection', async (input, init) => {
    assert.equal(input, '/api/connections/sync');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { workspace_id: 'workspace', connection_id: 'connection' });
    return Response.json({ ok: true });
  });
  assert.deepEqual(result, { ok: true, message: 'Sync queued.' });
});

test('sync request returns a retryable message after a network failure', async () => {
  const result = await requestConnectionSync('workspace', 'connection', async () => { throw new Error('offline'); });
  assert.deepEqual(result, { ok: false, message: 'Sync could not be queued. Check your connection and try again.' });
});

test('sync request describes stale, inactive, unavailable, and malformed responses', async () => {
  for (const [error, expected] of [
    ['connection_changed', 'This connection changed. Refresh the page and try again.'],
    ['connection_inactive', 'This connection is not active. Reconnect or finish setup before syncing.'],
    ['connection_job_fencing_unavailable', 'Sync is temporarily unavailable. Try again later.']
  ]) {
    const result = await requestConnectionSync('workspace', 'connection', async () => Response.json({ error }, { status: 409 }));
    assert.deepEqual(result, { ok: false, message: expected });
  }
  const malformed = await requestConnectionSync('workspace', 'connection', async () => new Response('bad', { status: 500 }));
  assert.deepEqual(malformed, { ok: false, message: 'Sync could not be queued.' });
});
