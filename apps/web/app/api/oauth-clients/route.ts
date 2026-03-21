import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createOAuthClient, listOAuthClients } from '@plusmy/core';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const clients = await listOAuthClients(user.id);
  return NextResponse.json({ clients });
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
  const client = await createOAuthClient(user.id, {
    client_name: String(body.client_name ?? 'Untitled MCP client'),
    redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: String(body.scope ?? 'mcp:tools mcp:resources'),
    token_endpoint_auth_method: body.token_endpoint_auth_method === 'client_secret_post' ? 'client_secret_post' : 'none'
  });

  return NextResponse.json({ client }, { status: 201 });
}
