import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { McpJsonRpcRequest } from '@plusmy/contracts';
import { handleMcpJsonRpcRequest } from '@plusmy/mcp';
import { resolveMcpAuthContextFromRequest } from '@plusmy/core';

export const runtime = 'nodejs';

const mcpJsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional()
});

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
        'WWW-Authenticate': `Bearer realm="plusmy.ai", resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      }
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version'
    }
  });
}

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    name: 'plusmy.ai MCP endpoint',
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource`,
    authorizationMetadata: `${origin}/.well-known/oauth-authorization-server`
  });
}

export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const authContext = await resolveMcpAuthContextFromRequest(request);
  if (!authContext) return unauthorized(origin);

  const body = mcpJsonRpcRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC request.',
          data: body.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        }
      },
      {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version'
        }
      }
    );
  }

  const result = await handleMcpJsonRpcRequest(authContext, body.data as McpJsonRpcRequest);
  return NextResponse.json(result.response, {
    headers: withRateLimitHeaders(
      {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version'
      },
      result.rateLimit
    )
  });
}
