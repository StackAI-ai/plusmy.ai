import { Badge, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs, listToolInvocations, listUserWorkspaces } from '@plusmy/core';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

export default async function AuditPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Audit and rate control</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Sign in to inspect OAuth approvals, MCP tool calls, refresh failures, and workspace administration events.
        </p>
      </Card>
    );
  }

  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);
  const [audit, invocations] = workspace
    ? await Promise.all([listAuditLogs(workspace.id, 20), listToolInvocations(workspace.id, 20)])
    : [[], []];

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Audit and rate control</h1>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Latest security and execution events emitted by workspace operators, MCP clients, and internal workers.
            </p>
          </div>
          <Badge tone="moss">{workspace?.name ?? 'No workspace'}</Badge>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Audit events</h2>
            <Badge tone="moss">{audit.length}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {audit.length === 0 ? (
              <p className="text-sm text-slate-700">No audit events yet.</p>
            ) : (
              audit.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{entry.action}</p>
                    <Badge tone={entry.status === 'error' ? 'brass' : 'moss'}>{entry.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {entry.resource_type}
                    {entry.resource_id ? ` • ${entry.resource_id}` : ''}
                  </p>
                  {entry.actor_type ? <p className="mt-1 text-xs text-slate-500">{entry.actor_type}</p> : null}
                  {entry.metadata && Object.keys(entry.metadata).length ? (
                    <pre className="mt-3 overflow-x-auto rounded-2xl bg-black/5 p-3 text-xs text-slate-600">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  ) : null}
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">{entry.created_at}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Tool invocations</h2>
            <Badge tone="moss">{invocations.length}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {invocations.length === 0 ? (
              <p className="text-sm text-slate-700">No tool invocations yet.</p>
            ) : (
              invocations.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{entry.tool_name}</p>
                    <Badge tone={entry.status === 'error' ? 'brass' : 'moss'}>{entry.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    {entry.provider}
                    {entry.connection_id ? ` • ${entry.connection_id}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{`${entry.latency_ms} ms`}</p>
                  {entry.error_message ? <p className="mt-2 text-sm text-red-700">{entry.error_message}</p> : null}
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">{entry.created_at}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
