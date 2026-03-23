import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  listUserWorkspaces,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole
} from '@plusmy/core';
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const workspaceQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

const patchWorkspaceMemberSchema = z.object({
  workspace_id: z.string().uuid(),
  member_id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member'])
});

const deleteWorkspaceMemberSchema = z.object({
  workspace_id: z.string().uuid(),
  member_id: z.string().uuid()
});

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let query: z.infer<typeof workspaceQuerySchema>;
  try {
    query = parseSearchParams(request.url, workspaceQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null);
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

  let body: z.infer<typeof patchWorkspaceMemberSchema>;
  try {
    body = await parseJsonBody(request, patchWorkspaceMemberSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (workspace == null) return NextResponse.json({ error: 'workspace_required' }, { status: 404 });

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const hasManageAccess = canManageWorkspace(membership?.role);
  if (hasManageAccess === false) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const actorIsOwner = membership?.role === 'owner';
  const ownerSelected = body.role === 'owner';
  if (ownerSelected && actorIsOwner === false) {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  const members = await listWorkspaceMembers(workspace.id);
  const target = members.find((member) => member.id === body.member_id);
  if (target == null) {
    return NextResponse.json({ error: 'member_not_found' }, { status: 404 });
  }

  const targetIsOwner = target.role === 'owner';
  if (targetIsOwner && actorIsOwner === false) {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  await updateWorkspaceMemberRole({
    workspaceId: workspace.id,
    memberId: body.member_id,
    role: body.role,
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

  let body: z.infer<typeof deleteWorkspaceMemberSchema>;
  try {
    body = await parseJsonBody(request, deleteWorkspaceMemberSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (workspace == null) return NextResponse.json({ error: 'workspace_required' }, { status: 404 });

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const hasManageAccess = canManageWorkspace(membership?.role);
  if (hasManageAccess === false) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const members = await listWorkspaceMembers(workspace.id);
  const target = members.find((member) => member.id === body.member_id);
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
    memberId: body.member_id,
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
}
