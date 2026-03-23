import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  getOAuthClientApprovalById,
  listOAuthClientApprovals,
  listUserWorkspaces,
  revokeOAuthClientApproval
} from '@plusmy/core';
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../../_lib/validation';

export const runtime = 'nodejs';

const workspaceQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

const deleteApprovalSchema = z.object({
  workspace_id: z.string().uuid(),
  approval_id: z.string().uuid()
});

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

  let query: z.infer<typeof workspaceQuerySchema>;
  try {
    query = parseSearchParams(request.url, workspaceQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null);
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

  let body: z.infer<typeof deleteApprovalSchema>;
  try {
    body = await parseJsonBody(request, deleteApprovalSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (workspace == null) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const approval = await getOAuthClientApprovalById(body.approval_id);

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
