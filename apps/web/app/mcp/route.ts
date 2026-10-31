import { NextRequest, NextResponse } from 'next/server';
import { handleMcpHttpPayload, handleMcpJsonRpcRequest } from '@plusmy/mcp';
import { resolveMcpAuthContextFromRequest } from '@plusmy/core';
import { guardMcpOrigin } from './origin-guard';

export const runtime = 'nodejs';

function withRateLimitHeaders(headers: Record<string, string>, rateLimit?: { limit: number; remaining: number; resetAt: number; resetAfterSeconds: number }) {
  if (!rateLimit) {
    return headers;
  }

  return {
    ...headers,
    'RateLimit-Limit': String(rateLimit.limit),
    'RateLimit-Remaining': String(rateLimit.remaining),
    'RateLimit-Reset': String(rateLimit.resetAfterSeconds),
    'X-RateLimit-Limit': String(rateLimit.limit),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(rateLimit.resetAt)
  } satisfies HeadersInit;
}

function unauthorized(origin: string, headers: Record<string, string>) {
  return NextResponse.json(
    { error: 'unauthorized', error_description: 'Bearer token required.' },
    {
      status: 401,
      headers: {
        ...headers,
        'WWW-Authenticate': `Bearer realm="plusmy.ai", resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      }
    }
  );
}

export async function OPTIONS(request: NextRequest) {
  const guard = guardMcpOrigin(request);
  if (!guard.allowed) return guard.response;
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...guard.headers,
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

export async function GET(request: NextRequest) {
  const guard = guardMcpOrigin(request);
  if (!guard.allowed) return guard.response;
  return new NextResponse(null, {
    status: 405,
    headers: { ...guard.headers, Allow: 'POST, OPTIONS' }
  });
}

export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

export async function POST(request: NextRequest) {
  const guard = guardMcpOrigin(request);
  if (!guard.allowed) return guard.response;
  const authContext = await resolveMcpAuthContextFromRequest(request);
  if (!authContext) return unauthorized(guard.appOrigin, guard.headers);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Invalid JSON.' }
      },
      { status: 400, headers: guard.headers }
    );
  }

  const result = await handleMcpHttpPayload(payload, (body) => handleMcpJsonRpcRequest(authContext, body));
  if (result.status === 202) return new NextResponse(null, { status: 202, headers: guard.headers });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: withRateLimitHeaders(guard.headers, result.rateLimit)
  });
}
