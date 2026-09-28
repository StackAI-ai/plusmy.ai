import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { CONTEXT_WRITE_FORBIDDEN, createContextAsset, getAuthorizedWorkspace, listContextAssets } from '@plusmy/core';
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const contextAssetQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
});

const createContextAssetSchema = z.object({
  workspace_id: z.string().uuid(),
  scope: z.enum(['workspace', 'personal']).default('workspace'),
  type: z.enum(['document', 'prompt', 'brand_guideline', 'workflow', 'knowledge_base']),
  title: z.string().trim().min(1).max(160),
  content: z.string().min(1),
  source_uri: z.string().trim().max(2000).nullable().optional().or(z.literal('')).optional(),
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

  let query: z.infer<typeof contextAssetQuerySchema>;
  try {
    query = parseSearchParams(request.url, contextAssetQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null);
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

  let body: z.infer<typeof createContextAssetSchema>;
  try {
    body = await parseJsonBody(request, createContextAssetSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  try {
    const asset = await createContextAsset({
      workspaceId: workspace.id,
      actorUserId: user.id,
      ownerUserId: (body.scope ?? 'workspace') === 'personal' ? user.id : null,
      type: body.type,
      title: body.title,
      content: body.content,
      sourceUri: body.source_uri ? body.source_uri : null,
      metadata: body.metadata ?? {}
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Context asset create failed.';
    return NextResponse.json({ error: message }, { status: message === CONTEXT_WRITE_FORBIDDEN ? 403 : 400 });
  }
}
