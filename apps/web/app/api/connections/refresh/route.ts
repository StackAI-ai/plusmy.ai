import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { forceRefreshConnection, getAuthorizedWorkspace, getConnectionById, listUserWorkspaces } from '@plusmy/core';

export const runtime = 'nodejs';

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''));
  if (!workspace) return NextResponse.json({ error: 'workspace_required' }, { status: 404 });

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const connection = await getConnectionById(String(body.connection_id ?? ''));
  if (!connection || connection.workspace_id !== workspace.id) {
    return NextResponse.json({ error: 'connection_not_found' }, { status: 404 });
  }

  const canRefresh =
    connection.scope === 'workspace'
      ? canManageWorkspace(membership?.role)
      : canManageWorkspace(membership?.role) || connection.owner_user_id === user.id;

  if (!canRefresh) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await forceRefreshConnection(connection.id);
  return NextResponse.json({ ok: true, connection_id: connection.id });
}
