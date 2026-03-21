import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createPromptTemplate, getAuthorizedWorkspace, listPromptTemplates } from '@plusmy/core';

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

  const prompts = await listPromptTemplates(workspace.id, user.id);
  return NextResponse.json({ workspace, prompts });
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

  const prompt = await createPromptTemplate({
    workspaceId: workspace.id,
    ownerUserId: body.scope === 'personal' ? user.id : null,
    name: String(body.name ?? 'Untitled prompt'),
    description: body.description ? String(body.description) : null,
    content: String(body.content ?? ''),
    metadata: body.metadata ?? {}
  });

  return NextResponse.json({ prompt }, { status: 201 });
}
