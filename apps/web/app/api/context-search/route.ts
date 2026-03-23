import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getAuthorizedWorkspace, matchContextChunks } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const contextSearchSchema = z.object({
  workspace_id: z.string().uuid(),
  query: z.string().trim().min(1).max(4000),
  limit: z.coerce.number().int().min(1).max(20).default(8)
});

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof contextSearchSchema>;
  try {
    body = await parseJsonBody(request, contextSearchSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const matches = await matchContextChunks(workspace.id, body.query, body.limit ?? 8);
  return NextResponse.json({ matches });
}
