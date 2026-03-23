import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  createWorkspaceInvite,
  getAuthorizedWorkspace,
  listUserWorkspaces,
  listWorkspaceInvites,
  revokeWorkspaceInvite
} from '@plusmy/core';
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const workspaceQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

const createInviteSchema = z.object({
  workspace_id: z.string().uuid(),
  email: z.string().trim().email(),
  role: z.enum(['owner', 'admin', 'member']).default('member')
});

const deleteInviteSchema = z.object({
  workspace_id: z.string().uuid(),
  invite_id: z.string().uuid()
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
  const invites = await listWorkspaceInvites(workspace.id);
  return NextResponse.json({ workspace, invites, role: membership?.role ?? null });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof createInviteSchema>;
  try {
    body = await parseJsonBody(request, createInviteSchema);
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
  const ownerRequested = body.role === 'owner';
  if (ownerRequested && actorIsOwner === false) {
    return NextResponse.json({ error: 'owner_required' }, { status: 403 });
  }

  const invite = await createWorkspaceInvite({
    workspaceId: workspace.id,
    invitedBy: user.id,
    email: body.email,
    role: body.role ?? 'member'
  });

  return NextResponse.json({ invite }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user == null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof deleteInviteSchema>;
  try {
    body = await parseJsonBody(request, deleteInviteSchema);
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

  await revokeWorkspaceInvite({
    workspaceId: workspace.id,
    inviteId: body.invite_id,
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
}
