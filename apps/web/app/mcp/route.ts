import { NextRequest, NextResponse } from 'next/server';
import { handleMcpHttpPayload, handleMcpJsonRpcRequest } from '@plusmy/mcp';
import { resolveMcpAuthContextFromRequest } from '@plusmy/core';

export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate'
};

function withRateLimitHeaders(headers: HeadersInit, rateLimit?: { limit: number; remaining: number; resetAt: number; resetAfterSeconds: number }) {
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

function unauthorized(origin: string) {
  return NextResponse.json(
    { error: 'unauthorized', error_description: 'Bearer token required.' },
    {
      status: 401,
      headers: {
        ...corsHeaders,
        'WWW-Authenticate': `Bearer realm="plusmy.ai", resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      }
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

export async function GET() {
  return new NextResponse(null, {
    status: 405,
    headers: { ...corsHeaders, Allow: 'POST, OPTIONS' }
  });
}

export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const authContext = await resolveMcpAuthContextFromRequest(request);
  if (!authContext) return unauthorized(origin);

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
      { status: 400, headers: corsHeaders }
    );
  }

  const result = await handleMcpHttpPayload(payload, (body) => handleMcpJsonRpcRequest(authContext, body));
  if (result.status === 202) return new NextResponse(null, { status: 202, headers: corsHeaders });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: withRateLimitHeaders(corsHeaders, result.rateLimit)
  });
}
