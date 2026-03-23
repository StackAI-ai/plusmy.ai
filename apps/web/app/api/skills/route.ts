import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createSkillDefinition, getAuthorizedWorkspace, listSkillDefinitions, updateSkillDefinition } from '@plusmy/core';
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const skillQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

const createSkillSchema = z.object({
  workspace_id: z.string().uuid(),
  scope: z.enum(['workspace', 'personal']).default('workspace'),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  instructions: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const updateSkillSchema = z.object({
  workspace_id: z.string().uuid(),
  skill_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  instructions: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let query: z.infer<typeof skillQuerySchema>;
  try {
    query = parseSearchParams(request.url, skillQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null);
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

  let body: z.infer<typeof createSkillSchema>;
  try {
    body = await parseJsonBody(request, createSkillSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const skill = await createSkillDefinition({
    workspaceId: workspace.id,
    ownerUserId: (body.scope ?? 'workspace') === 'personal' ? user.id : null,
    name: body.name,
    description: body.description ?? null,
    instructions: body.instructions,
    metadata: body.metadata ?? {}
  });

  return NextResponse.json({ skill }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof updateSkillSchema>;
  try {
    body = await parseJsonBody(request, updateSkillSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  try {
    const skill = await updateSkillDefinition({
      workspaceId: workspace.id,
      skillDefinitionId: body.skill_id,
      actorUserId: user.id,
      name: body.name,
      description: body.description ?? null,
      instructions: body.instructions,
      metadata: body.metadata ?? {}
    });

    return NextResponse.json({ skill });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Skill update failed.';
    const status = message === 'Skill definition not found.' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
