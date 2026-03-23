import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { exchangeAuthorizationCode, exchangeRefreshToken } from '@plusmy/core';

export const runtime = 'nodejs';

const authorizationCodeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  code_verifier: z.string().min(1),
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional()
});

const refreshTokenGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional()
});

const tokenRequestSchema = z.union([authorizationCodeGrantSchema, refreshTokenGrantSchema]);

function parseBasicAuth(header: string | null) {
  if (!header?.startsWith('Basic ')) return { clientId: null, clientSecret: null };
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const [clientId, clientSecret] = decoded.split(':');
  return { clientId: clientId ?? null, clientSecret: clientSecret ?? null };
}

async function parseTokenRequest(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return await request.json();
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(request: NextRequest) {
  const rawBody = await parseTokenRequest(request);
  const basic = parseBasicAuth(request.headers.get('authorization'));
  const parsed = tokenRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        error_description: parsed.error.issues.map((issue) => issue.message).join('; ')
      },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const grantType = body.grant_type;
  const clientId = body.client_id ?? basic.clientId ?? '';
  const clientSecret = body.client_secret ?? basic.clientSecret ?? '';

  try {
    if (grantType === 'authorization_code') {
      const token = await exchangeAuthorizationCode({
        clientId,
        clientSecret: clientSecret || null,
        code: body.code,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier
      });
      return NextResponse.json(token);
    }

    if (grantType === 'refresh_token') {
      const token = await exchangeRefreshToken({
        clientId,
        clientSecret: clientSecret || null,
        refreshToken: body.refresh_token
      });
      return NextResponse.json(token);
    }

    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'invalid_grant',
        error_description: error instanceof Error ? error.message : 'Token exchange failed.'
      },
      { status: 400 }
    );
  }
}
