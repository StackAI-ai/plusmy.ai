import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createContextAsset, getAuthorizedWorkspace, listContextAssets } from '@plusmy/core';

export const runtime = 'nodejs';

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
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const assets = await listContextAssets(workspace.id, user.id);
  return NextResponse.json({ workspace, assets });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''));
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const asset = await createContextAsset({
    workspaceId: workspace.id,
    ownerUserId: body.scope === 'personal' ? user.id : null,
    type: body.type,
    title: String(body.title ?? 'Untitled asset'),
    content: String(body.content ?? ''),
    sourceUri: body.source_uri ? String(body.source_uri) : null,
    metadata: body.metadata ?? {}
  });

  return NextResponse.json({ asset }, { status: 201 });
}
