import { NextRequest, NextResponse } from 'next/server';
import { handleMcpJsonRpcRequest } from '@plusmy/mcp';
import { resolveMcpAuthContextFromRequest } from '@plusmy/core';

export const runtime = 'nodejs';

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

  const body = await request.json();
  const response = await handleMcpJsonRpcRequest(authContext, body);
  return NextResponse.json(response, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version'
    }
  });
}
