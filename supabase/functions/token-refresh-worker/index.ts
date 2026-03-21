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
  const payload = await request.json().catch(() => null);
  const connectionId = payload?.connection_id as string | undefined;
  if (!connectionId) {
    return new Response(JSON.stringify({ error: 'connection_id is required' }), { status: 400 });
  }

  const { data: connection } = await supabase.schema('app').from('connections').select('workspace_id').eq('id', connectionId).maybeSingle();
  const response = await fetch(`${appUrl}/api/internal/token-refresh`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-plusmy-worker-secret': workerSharedSecret
    },
    body: JSON.stringify({ connectionId })
  });

  if (connection?.workspace_id) {
    await supabase.schema('app').from('audit_logs').insert({
      workspace_id: connection.workspace_id,
      actor_type: 'system',
      action: 'token_refresh.worker_invoked',
      resource_type: 'connection',
      resource_id: connectionId,
      status: response.ok ? 'success' : 'error',
      metadata: { responseStatus: response.status }
    });
  }

  return new Response(JSON.stringify({ ok: response.ok, status: response.status }), { status: response.ok ? 200 : 500 });
});
