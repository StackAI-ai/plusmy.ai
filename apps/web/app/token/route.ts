import { NextRequest, NextResponse } from 'next/server';
import { exchangeAuthorizationCode, exchangeRefreshToken } from '@plusmy/core';

export const runtime = 'nodejs';

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
  const body = await parseTokenRequest(request);
  const basic = parseBasicAuth(request.headers.get('authorization'));
  const grantType = String(body.grant_type ?? '');
  const clientId = String(body.client_id ?? basic.clientId ?? '');
  const clientSecret = String(body.client_secret ?? basic.clientSecret ?? '');

  try {
    if (grantType === 'authorization_code') {
      const token = await exchangeAuthorizationCode({
        clientId,
        clientSecret: clientSecret || null,
        code: String(body.code ?? ''),
        redirectUri: String(body.redirect_uri ?? ''),
        codeVerifier: String(body.code_verifier ?? '')
      });
      return NextResponse.json(token);
    }

    if (grantType === 'refresh_token') {
      const token = await exchangeRefreshToken({
        clientId,
        clientSecret: clientSecret || null,
        refreshToken: String(body.refresh_token ?? '')
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
