import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { registerDynamicClient } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../api/_lib/validation';

export const runtime = 'nodejs';

const registerClientSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().trim().min(1).optional(),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional()
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof registerClientSchema>;
  try {
    body = await parseJsonBody(request, registerClientSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const registration = await registerDynamicClient(body, user?.id ?? null);
  return NextResponse.json(registration, { status: 201 });
}
