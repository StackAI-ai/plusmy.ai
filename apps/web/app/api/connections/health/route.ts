import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listConnectionHealthSnapshots } from '@plusmy/core';
import { parseSearchParams, validationErrorResponse } from '../../_lib/validation';

export const runtime = 'nodejs';

const workspaceQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

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
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const snapshots = await listConnectionHealthSnapshots(workspace.id, user.id);
  return NextResponse.json({ workspace, snapshots });
}
