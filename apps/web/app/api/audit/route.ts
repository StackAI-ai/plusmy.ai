import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs, listToolInvocations, listUserWorkspaces } from '@plusmy/core';

export const runtime = 'nodejs';

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function normalizeLimit(value: string | null, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspace = await getAuthorizedWorkspace(user.id, url.searchParams.get('workspace_id'));
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const workspaces = await listUserWorkspaces(user.id);
  const membership = workspaces.find((entry) => entry.id === workspace.id);
  if (!canManageWorkspace(membership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const limit = normalizeLimit(url.searchParams.get('limit'), 25);
  const status = url.searchParams.get('status');
  const actorType = url.searchParams.get('actor') ?? url.searchParams.get('actor_type');
  const resourceType = url.searchParams.get('resource') ?? url.searchParams.get('resource_type');
  const resourceId = url.searchParams.get('resource_id');
  const actionPrefix = url.searchParams.get('action') ?? url.searchParams.get('action_prefix');
  const clientId = url.searchParams.get('client') ?? url.searchParams.get('client_id');
  const provider = url.searchParams.get('provider');
  const toolName = url.searchParams.get('tool') ?? url.searchParams.get('tool_name');
  const auditCursor = url.searchParams.get('audit_cursor');
  const auditDirection = url.searchParams.get('audit_direction');
  const invocationCursor = url.searchParams.get('invocation_cursor');
  const invocationDirection = url.searchParams.get('invocation_direction');

  const audit = await listAuditLogs(workspace.id, {
    limit,
    status,
    actorType: actorType as 'user' | 'mcp_client' | 'system' | null,
    resourceType,
    resourceId,
    actionPrefix,
    clientId,
    cursor: auditCursor,
    direction: auditDirection === 'prev' ? 'prev' : 'next'
  });
  const invocations = await listToolInvocations(workspace.id, {
    limit,
    status,
    provider,
    toolName,
    actorClientId: clientId,
    connectionId: url.searchParams.get('connection'),
    cursor: invocationCursor,
    direction: invocationDirection === 'prev' ? 'prev' : 'next'
  });
  return NextResponse.json({ workspace, audit, invocations });
}
