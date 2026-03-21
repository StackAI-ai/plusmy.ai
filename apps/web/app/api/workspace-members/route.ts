import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  listUserWorkspaces,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole
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
  const members = await listWorkspaceMembers(workspace.id);
  return NextResponse.json({ workspace, members, role: membership?.role ?? null });
}

export async function PATCH(request: NextRequest) {
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

  const nextRole = body.role === 'owner' || body.role === 'admin' || body.role === 'member' ? body.role : null;
  if (nextRole == null) {
    return NextResponse.json({ error: 'invalid_role' }, { status: 400 });
  }

  const actorIsOwner = membership?.role === 'owner';
  const ownerSelected = nextRole === 'owner';
  if (ownerSelected && actorIsOwner === false) {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  const members = await listWorkspaceMembers(workspace.id);
  const target = members.find((member) => member.id === String(body.member_id ?? ''));
  if (target == null) {
    return NextResponse.json({ error: 'member_not_found' }, { status: 404 });
  }

  const targetIsOwner = target.role === 'owner';
  if (targetIsOwner && actorIsOwner === false) {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  await updateWorkspaceMemberRole({
    workspaceId: workspace.id,
    memberId: String(body.member_id ?? ''),
    role: nextRole,
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
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

  const members = await listWorkspaceMembers(workspace.id);
  const target = members.find((member) => member.id === String(body.member_id ?? ''));
  if (target == null) {
    return NextResponse.json({ error: 'member_not_found' }, { status: 404 });
  }

  const actorIsOwner = membership?.role === 'owner';
  const targetIsOwner = target.role === 'owner';
  if (targetIsOwner && actorIsOwner === false) {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  await removeWorkspaceMember({
    workspaceId: workspace.id,
    memberId: String(body.member_id ?? ''),
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
}
