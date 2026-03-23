import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { createOAuthClient, listOAuthClients } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../_lib/validation';

export const runtime = 'nodejs';

const createOAuthClientSchema = z.object({
  client_name: z.string().trim().min(1).max(120).default('Untitled MCP client'),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  scope: z.string().trim().min(1).default('mcp:tools mcp:resources'),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post']).default('none')
});

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

  let body: z.infer<typeof createOAuthClientSchema>;
  try {
    body = await parseJsonBody(request, createOAuthClientSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const client = await createOAuthClient(user.id, {
    client_name: body.client_name ?? 'Untitled MCP client',
    redirect_uris: body.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: body.scope ?? 'mcp:tools mcp:resources',
    token_endpoint_auth_method: body.token_endpoint_auth_method ?? 'none'
  });

  return NextResponse.json({ client }, { status: 201 });
}
