import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { registerDynamicClient } from '@plusmy/core';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const registration = await registerDynamicClient(body, user?.id ?? null);
  return NextResponse.json(registration, { status: 201 });
}
