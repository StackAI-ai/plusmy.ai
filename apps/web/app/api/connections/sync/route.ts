import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { canManageConnection, getAuthorizedWorkspace, getConnectionById, listUserWorkspaces, scheduleConnectionSyncJob } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../../_lib/validation';

export const runtime = 'nodejs';

const bodySchema = z.object({ workspace_id: z.string().uuid(), connection_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseJsonBody(request, bodySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) return NextResponse.json({ error: 'workspace_required' }, { status: 404 });

  const memberships = await listUserWorkspaces(user.id);
  const membership = memberships.find((entry) => entry.id === workspace.id);
  const connection = await getConnectionById(body.connection_id);
  if (!connection || connection.workspace_id !== workspace.id) {
    return NextResponse.json({ error: 'connection_not_found' }, { status: 404 });
  }

  if (!canManageConnection(connection, user.id, membership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (connection.status === 'revoked') {
    return NextResponse.json({ error: 'connection_revoked' }, { status: 400 });
  }

  const jobId = await scheduleConnectionSyncJob({
    connectionId: connection.id,
    actorUserId: user.id,
    payload: {
      requested_by: user.id,
      source: 'operator'
    }
  });

  return NextResponse.json({ ok: true, connection_id: connection.id, job_id: jobId });
}
