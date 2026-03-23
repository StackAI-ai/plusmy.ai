import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs, listToolInvocations, listUserWorkspaces } from '@plusmy/core';
import { parseSearchParams, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const auditQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  limit: z.string().optional(),
  status: z.string().optional(),
  actor: z.enum(['user', 'mcp_client', 'system']).optional(),
  actor_type: z.enum(['user', 'mcp_client', 'system']).optional(),
  resource: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  action: z.string().optional(),
  action_prefix: z.string().optional(),
  client: z.string().optional(),
  client_id: z.string().optional(),
  provider: z.string().optional(),
  tool: z.string().optional(),
  tool_name: z.string().optional(),
  connection: z.string().uuid().optional(),
  audit_cursor: z.string().optional(),
  audit_direction: z.enum(['next', 'prev']).optional(),
  invocation_cursor: z.string().optional(),
  invocation_direction: z.enum(['next', 'prev']).optional()
});

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

  let query: z.infer<typeof auditQuerySchema>;
  try {
    query = parseSearchParams(request.url, auditQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const workspaces = await listUserWorkspaces(user.id);
  const membership = workspaces.find((entry) => entry.id === workspace.id);
  if (!canManageWorkspace(membership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const limit = normalizeLimit(query.limit ?? null, 25);
  const status = query.status ?? null;
  const actorType = query.actor ?? query.actor_type ?? null;
  const resourceType = query.resource ?? query.resource_type ?? null;
  const resourceId = query.resource_id ?? null;
  const actionPrefix = query.action ?? query.action_prefix ?? null;
  const clientId = query.client ?? query.client_id ?? null;
  const provider = query.provider ?? null;
  const toolName = query.tool ?? query.tool_name ?? null;
  const auditCursor = query.audit_cursor ?? null;
  const auditDirection = query.audit_direction ?? null;
  const invocationCursor = query.invocation_cursor ?? null;
  const invocationDirection = query.invocation_direction ?? null;

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
    connectionId: query.connection ?? null,
    cursor: invocationCursor,
    direction: invocationDirection === 'prev' ? 'prev' : 'next'
  });
  return NextResponse.json({ workspace, audit, invocations });
}
