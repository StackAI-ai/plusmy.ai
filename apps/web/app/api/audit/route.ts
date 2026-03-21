import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, listAuditLogs } from '@plusmy/core';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspace = await getAuthorizedWorkspace(user.id, url.searchParams.get('workspace_id'));
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const limit = Number(url.searchParams.get('limit') ?? 25);
  const audit = await listAuditLogs(workspace.id, limit);
  return NextResponse.json({ workspace, audit });
}
