import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createWorkspaceBootstrap, listUserWorkspaces } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).optional().nullable()
});

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const workspaces = await listUserWorkspaces(user.id);
  return NextResponse.json({ workspaces });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof createWorkspaceSchema>;
  try {
    body = await parseJsonBody(request, createWorkspaceSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await createWorkspaceBootstrap({
    userId: user.id,
    name: body.name,
    slug: body.slug ?? null
  });

  return NextResponse.json({ workspace }, { status: 201 });
}
