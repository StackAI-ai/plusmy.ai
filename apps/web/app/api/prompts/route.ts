import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createPromptTemplate, getAuthorizedWorkspace, listPromptTemplates, updatePromptTemplate } from '@plusmy/core';
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const promptQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

const createPromptSchema = z.object({
  workspace_id: z.string().uuid(),
  scope: z.enum(['workspace', 'personal']).default('workspace'),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const updatePromptSchema = z.object({
  workspace_id: z.string().uuid(),
  prompt_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  content: z.string().min(1),
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

  let query: z.infer<typeof promptQuerySchema>;
  try {
    query = parseSearchParams(request.url, promptQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null);
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

  let body: z.infer<typeof createPromptSchema>;
  try {
    body = await parseJsonBody(request, createPromptSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const prompt = await createPromptTemplate({
    workspaceId: workspace.id,
    ownerUserId: (body.scope ?? 'workspace') === 'personal' ? user.id : null,
    name: body.name,
    description: body.description ?? null,
    content: body.content,
    metadata: body.metadata ?? {}
  });

  return NextResponse.json({ prompt }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof updatePromptSchema>;
  try {
    body = await parseJsonBody(request, updatePromptSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  try {
    const prompt = await updatePromptTemplate({
      workspaceId: workspace.id,
      promptTemplateId: body.prompt_id,
      actorUserId: user.id,
      name: body.name,
      description: body.description ?? null,
      content: body.content,
      metadata: body.metadata ?? {}
    });

    return NextResponse.json({ prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prompt update failed.';
    const status = message === 'Prompt template not found.' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
