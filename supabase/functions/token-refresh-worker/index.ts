import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

Deno.serve(async (request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL');
  const workerSharedSecret = Deno.env.get('WORKER_SHARED_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !appUrl || !workerSharedSecret) {
    return new Response(JSON.stringify({ error: 'Missing function environment.' }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const payload = await request.json().catch(() => ({}));
  const connectionId = payload?.connection_id as string | undefined;
  const jobType = payload?.job_type as string | undefined;
  const limit = Number(payload?.limit ?? 5);

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
      payload: payload?.payload ?? (payload?.reason ? { reason: payload.reason } : undefined)
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
