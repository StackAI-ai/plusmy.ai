import { Badge, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs, listUserWorkspaces } from '@plusmy/core';
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
  const audit = workspace ? await listAuditLogs(workspace.id, 20) : [];

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

      <Card>
        <div className="space-y-3">
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
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{entry.created_at}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
