import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  createWorkspaceInvite,
  getAuthorizedWorkspace,
  listUserWorkspaces,
  listWorkspaceInvites,
  revokeWorkspaceInvite
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

  if (user == null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspace = await getAuthorizedWorkspace(user.id, new URL(request.url).searchParams.get('workspace_id'));
  if (workspace == null) return NextResponse.json({ error: 'workspace_required' }, { status: 404 });

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const invites = await listWorkspaceInvites(workspace.id);
  return NextResponse.json({ workspace, invites, role: membership?.role ?? null });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''));
  if (workspace == null) return NextResponse.json({ error: 'workspace_required' }, { status: 404 });

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const hasManageAccess = canManageWorkspace(membership?.role);
  if (hasManageAccess === false) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const actorIsOwner = membership?.role === 'owner';
  const ownerRequested = body.role === 'owner';
  if (ownerRequested && actorIsOwner === false) {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  const invite = await createWorkspaceInvite({
    workspaceId: workspace.id,
    invitedBy: user.id,
    email: String(body.email ?? ''),
    role: body.role === 'owner' || body.role === 'admin' ? body.role : 'member'
  });

  return NextResponse.json({ invite }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''));
  if (workspace == null) return NextResponse.json({ error: 'workspace_required' }, { status: 404 });

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const hasManageAccess = canManageWorkspace(membership?.role);
  if (hasManageAccess === false) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await revokeWorkspaceInvite({
    workspaceId: workspace.id,
    inviteId: String(body.invite_id ?? ''),
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
}
