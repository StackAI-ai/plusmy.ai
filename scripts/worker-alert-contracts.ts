import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

process.env.MCP_JWT_SECRET ??= 'local-worker-alert-test-secret-local-worker-alert-test';
process.env.WORKER_SHARED_SECRET ??= 'local-worker-alert-test-secret-local-worker-alert-test';

async function main() {
  const server = createServer();
  let deliveryStatus = 503;
  const deliveries: Array<{ id: string | undefined; body: Record<string, unknown> }> = [];
  server.on('request', async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    deliveries.push({
      id: request.headers['x-plusmy-alert-id'] as string | undefined,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    });
    response.writeHead(deliveryStatus).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.OPERATOR_ALERT_WEBHOOK_URL = `http://127.0.0.1:${address.port}/alert`;

  const { createServiceRoleClient } = await import('../packages/supabase/src/admin.ts');
  const { dispatchPendingConnectionJobAlerts } = await import('../packages/core/src/connections.ts');
  const service = createServiceRoleClient();
  const connectionId = randomUUID();
  const jobId = randomUUID();
  const workspaceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  try {
    const { error: connectionError } = await service.schema('app').from('connections').insert({
      id: connectionId,
      connection_key: `worker-alert-contract-${connectionId}`,
      workspace_id: workspaceId,
      provider: 'hubspot',
      scope: 'workspace',
      status: 'active',
      display_name: 'Disposable worker alert fixture'
    });
    assert.equal(connectionError, null);

    const { error: jobError } = await service.schema('app').from('connection_sync_jobs').insert({
      id: jobId,
      connection_id: connectionId,
      job_type: 'sync_connection',
      status: 'dead_letter',
      attempts: 4,
      max_attempts: 4,
      dead_lettered_at: new Date().toISOString(),
      last_error: 'Disposable provider failure: do not send to alert receiver'
    });
    assert.equal(jobError, null);

    const first = await dispatchPendingConnectionJobAlerts();
    assert.deepEqual(first, { configured: true, claimed: 1, delivered: 0, failed: 1 });
    assert.equal(deliveries[0]?.id, jobId);
    assert.equal(deliveries[0]?.body.event, 'connection_job.dead_lettered');
    assert.equal(deliveries[0]?.body.job_id, jobId);
    const auditUrl = new URL(String(deliveries[0]?.body.dashboard_url));
    assert.equal(auditUrl.searchParams.get('workspace'), workspaceId);
    assert.equal(auditUrl.searchParams.get('resource_id'), jobId);
    assert.ok(!JSON.stringify(deliveries[0]?.body).includes('Disposable provider failure'));
    const { data: failedJob } = await service.schema('app').from('connection_sync_jobs')
      .select('alerted_at, alert_claim_id').eq('id', jobId).single();
    assert.equal(failedJob?.alerted_at, null);
    assert.equal(failedJob?.alert_claim_id, null);

    deliveryStatus = 204;
    const second = await dispatchPendingConnectionJobAlerts();
    assert.deepEqual(second, { configured: true, claimed: 1, delivered: 1, failed: 0 });
    assert.deepEqual(deliveries.map((delivery) => delivery.id), [jobId, jobId]);
    const { data: deliveredJob } = await service.schema('app').from('connection_sync_jobs')
      .select('alerted_at, alert_claim_id').eq('id', jobId).single();
    assert.ok(deliveredJob?.alerted_at);
    assert.equal(deliveredJob?.alert_claim_id, null);

    const third = await dispatchPendingConnectionJobAlerts();
    assert.deepEqual(third, { configured: true, claimed: 0, delivered: 0, failed: 0 });
    const { data: audit } = await service.schema('app').from('audit_logs').select('action')
      .eq('resource_id', jobId).in('action', ['connection_job.alert_failed', 'connection_job.alert_delivered']);
    assert.deepEqual(audit?.map((entry) => entry.action).sort(), [
      'connection_job.alert_delivered',
      'connection_job.alert_failed'
    ]);
    console.log('Worker alert delivery, retry, stable IDs, and audit contracts passed.');
  } finally {
    await service.schema('app').from('audit_logs').delete().eq('resource_id', jobId);
    await service.schema('app').from('connections').delete().eq('id', connectionId);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
