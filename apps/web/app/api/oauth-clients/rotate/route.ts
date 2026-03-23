import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { rotateOAuthClientSecret } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../../_lib/validation';

export const runtime = 'nodejs';

const rotateSchema = z.object({
  client_id: z.string().min(1)
});

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof rotateSchema>;
  try {
    body = await parseJsonBody(request, rotateSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  try {
    const rotated = await rotateOAuthClientSecret({
      clientId: body.client_id,
      actorUserId: user.id
    });

    return NextResponse.json({ client: rotated, client_secret: rotated.client_secret }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Secret rotation failed.';
    const status = message === 'forbidden' ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
