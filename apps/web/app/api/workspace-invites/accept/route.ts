import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { acceptWorkspaceInvite } from '@plusmy/core';
import { parseJsonBody, validationErrorResponse } from '../../_lib/validation';

export const runtime = 'nodejs';

const acceptInviteSchema = z.object({ token: z.string().regex(/^[a-f0-9]{48}$/) });

const inviteErrors: Record<string, number> = {
  'Invite not found.': 404,
  'Invite already accepted.': 409,
  'Invite expired.': 410,
  'Invite email does not match current user.': 403,
  'You are already a member of this workspace.': 409
};

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof acceptInviteSchema>;
  try {
    body = await parseJsonBody(request, acceptInviteSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  let invite: Awaited<ReturnType<typeof acceptWorkspaceInvite>>;
  try {
    invite = await acceptWorkspaceInvite({ token: body.token, userId: user.id });
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
    const status = inviteErrors[message];
    if (status) return NextResponse.json({ error: message }, { status });
    throw error;
  }

  return NextResponse.json({ invite });
}
