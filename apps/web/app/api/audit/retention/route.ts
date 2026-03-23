import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listUserWorkspaces, purgeAuditLogs, purgeToolInvocations } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../../_lib/validation';

export const runtime = 'nodejs';

const retentionSchema = z.object({
  workspace_id: z.string().uuid(),
  retention_days: z.coerce.number().int().min(1).max(3650).default(180),
  target: z.enum(['audit', 'invocations', 'both']).default('both')
});

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof retentionSchema>;
  try {
    body = await parseJsonBody(request, retentionSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const workspaces = await listUserWorkspaces(user.id);
  const membership = workspaces.find((entry) => entry.id === workspace.id);
  if (!canManageWorkspace(membership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const before = new Date(Date.now() - body.retention_days * 24 * 60 * 60 * 1000).toISOString();

  let auditPurged = 0;
  let invocationPurged = 0;

  if (body.target === 'audit' || body.target === 'both') {
    auditPurged = await purgeAuditLogs(workspace.id, before);
  }

  if (body.target === 'invocations' || body.target === 'both') {
    invocationPurged = await purgeToolInvocations(workspace.id, before);
  }

  return NextResponse.json({
    workspace,
    before,
    retention_days: body.retention_days,
    purged: {
      audit_logs: auditPurged,
      tool_invocations: invocationPurged
    }
  });
}
