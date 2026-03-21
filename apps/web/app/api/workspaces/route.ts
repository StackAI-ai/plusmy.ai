import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createWorkspaceBootstrap, listUserWorkspaces } from '@plusmy/core';

export const runtime = 'nodejs';

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

  const body = await request.json();
  const workspace = await createWorkspaceBootstrap({
    userId: user.id,
    name: String(body.name ?? 'New workspace'),
    slug: body.slug ? String(body.slug) : null
  });

  return NextResponse.json({ workspace }, { status: 201 });
}
