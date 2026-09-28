import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL');
  const workerSharedSecret = Deno.env.get('WORKER_SHARED_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !appUrl || !workerSharedSecret) {
    return new Response(JSON.stringify({ error: 'Missing function environment.' }), { status: 500 });
  }

  if (request.headers.get('x-plusmy-worker-secret') !== workerSharedSecret) {
    return new Response(JSON.stringify({ error: 'Forbidden.' }), { status: 403 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const parsedPayload = await request.json().catch(() => null);
  const payload = parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)
    ? parsedPayload as Record<string, unknown>
    : {};
  const connectionId = typeof payload.connection_id === 'string' ? payload.connection_id : undefined;
  const jobType = typeof payload.job_type === 'string' ? payload.job_type : undefined;
  const requestedLimit = Number(payload.limit ?? 5);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.trunc(requestedLimit))) : 5;

  const { data: connection } = connectionId
    ? await supabase.schema('app').from('connections').select('workspace_id').eq('id', connectionId).maybeSingle()
    : { data: null };

  const response = await fetch(`${appUrl}/api/internal/connection-jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-plusmy-worker-secret': workerSharedSecret
    },
    body: JSON.stringify({
      connectionId,
      jobType,
      limit,
      payload: payload.payload ?? (payload.reason ? { reason: payload.reason } : undefined)
    })
  });

  if (connection?.workspace_id) {
    await supabase.schema('app').from('audit_logs').insert({
      workspace_id: connection.workspace_id,
      actor_type: 'system',
      action: 'connection_job.worker_invoked',
      resource_type: 'connection_job',
      resource_id: connectionId,
      status: response.ok ? 'success' : 'error',
      metadata: { responseStatus: response.status, jobType: jobType ?? 'token_refresh' }
    });
  }

  return new Response(await response.text(), { status: response.ok ? 200 : 500 });
});
