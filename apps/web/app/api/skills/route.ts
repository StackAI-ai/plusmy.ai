import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createSkillDefinition, getAuthorizedWorkspace, listSkillDefinitions } from '@plusmy/core';

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

  const skills = await listSkillDefinitions(workspace.id, user.id);
  return NextResponse.json({ workspace, skills });
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

  const skill = await createSkillDefinition({
    workspaceId: workspace.id,
    ownerUserId: body.scope === 'personal' ? user.id : null,
    name: String(body.name ?? 'Untitled skill'),
    description: body.description ? String(body.description) : null,
    instructions: String(body.instructions ?? ''),
    metadata: body.metadata ?? {}
  });

  return NextResponse.json({ skill }, { status: 201 });
}
