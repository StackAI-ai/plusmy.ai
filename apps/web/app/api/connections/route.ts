import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  canManageConnection,
  getAuthorizedWorkspace,
  getConnectionById,
  listConnectionsForWorkspace,
  listUserWorkspaces,
  revokeConnection
} from '@plusmy/core';
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const workspaceQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

const deleteConnectionSchema = z.object({
  workspace_id: z.string().uuid(),
  connection_id: z.string().uuid()
});

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let query: z.infer<typeof workspaceQuerySchema>;
  try {
    query = parseSearchParams(request.url, workspaceQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null);
  if (workspace == null) {
    const workspaces = await listUserWorkspaces(user.id);
    return NextResponse.json({ error: 'workspace_required', workspaces }, { status: 404 });
  }

  const connections = await listConnectionsForWorkspace(workspace.id, user.id);
  return NextResponse.json({ workspace, connections });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof deleteConnectionSchema>;
  try {
    body = await parseJsonBody(request, deleteConnectionSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (workspace == null) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const connection = await getConnectionById(body.connection_id);
  const matchesWorkspace = connection != null && connection.workspace_id === workspace.id;
  if (matchesWorkspace === false) {
    return NextResponse.json({ error: 'connection_not_found' }, { status: 404 });
  }

  if (!canManageConnection(connection, user.id, membership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await revokeConnection({
    workspaceId: workspace.id,
    connectionId: connection.id,
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
}
