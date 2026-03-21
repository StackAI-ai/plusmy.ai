import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { acceptWorkspaceInvite } from '@plusmy/core';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const invite = await acceptWorkspaceInvite({
    token: String(body.token ?? ''),
    userId: user.id,
    email: user.email ?? null
  });

  return NextResponse.json({ invite });
}
