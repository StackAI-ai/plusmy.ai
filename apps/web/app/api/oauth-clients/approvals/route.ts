import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  getOAuthClientApprovalById,
  listOAuthClientApprovals,
  listUserWorkspaces,
  revokeOAuthClientApproval
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

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const requestedWorkspace = new URL(request.url).searchParams.get('workspace_id');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspace);
  if (workspace == null) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const approvals = await listOAuthClientApprovals({
    workspaceId: workspace.id,
    userId: user.id,
    includeWorkspaceApprovals: canManageWorkspace(membership?.role)
  });

  return NextResponse.json({ workspace, approvals });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''));
  if (workspace == null) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const approval = await getOAuthClientApprovalById(String(body.approval_id ?? ''));

  if (!approval || approval.workspace_id !== workspace.id) {
    return NextResponse.json({ error: 'approval_not_found' }, { status: 404 });
  }

  const canRevoke = approval.user_id === user.id || canManageWorkspace(membership?.role);
  if (!canRevoke) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await revokeOAuthClientApproval({
    approvalId: approval.id,
    workspaceId: workspace.id,
    actorUserId: user.id
  });

  return NextResponse.json({ ok: true });
}
