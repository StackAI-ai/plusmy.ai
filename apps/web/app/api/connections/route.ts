import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  getConnectionById,
  listConnectionsForWorkspace,
  listUserWorkspaces,
  revokeConnection
} from '@plusmy/core';

export const runtime = 'nodejs';

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const requestedWorkspace = new URL(request.url).searchParams.get('workspace_id');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspace);
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

  const body = await request.json();
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''));
  if (workspace == null) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const connection = await getConnectionById(String(body.connection_id ?? ''));
  const matchesWorkspace = connection != null && connection.workspace_id === workspace.id;
  if (matchesWorkspace === false) {
    return NextResponse.json({ error: 'connection_not_found' }, { status: 404 });
  }

  const canManage =
    connection.scope === 'workspace'
      ? canManageWorkspace(membership?.role)
      : canManageWorkspace(membership?.role) || connection.owner_user_id === user.id;

  if (canManage === false) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await revokeConnection({
    workspaceId: workspace.id,
    connectionId: connection.id,
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
}
