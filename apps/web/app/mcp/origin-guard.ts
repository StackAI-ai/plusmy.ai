import { NextResponse } from 'next/server';
import { isMcpHttpOrigin, mcpOriginPolicySchema } from '@plusmy/config';

const safeHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Origin'
};

const exposedHeaders = [
  'WWW-Authenticate',
  'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset',
  'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'
].join(', ');

type OriginGuardResult =
  | { allowed: false; response: NextResponse }
  | { allowed: true; appOrigin: string; headers: Record<string, string> };

export function guardMcpOrigin(request: Request): OriginGuardResult {
  const policy = mcpOriginPolicySchema.safeParse({
    APP_URL: process.env.APP_URL,
    MCP_ALLOWED_ORIGINS: process.env.MCP_ALLOWED_ORIGINS
  });
  if (!policy.success) {
    return {
      allowed: false,
      response: NextResponse.json({ error: 'temporarily_unavailable', error_description: 'MCP origin policy is not configured.' }, {
        status: 503, headers: safeHeaders
      })
    };
  }

  const origin = request.headers.get('origin');
  if (origin !== null && (!isMcpHttpOrigin(origin) || (origin !== policy.data.APP_URL && !policy.data.MCP_ALLOWED_ORIGINS.includes(origin)))) {
    return {
      allowed: false,
      response: NextResponse.json({ error: 'forbidden', error_description: 'Origin is not allowed.' }, {
        status: 403, headers: safeHeaders
      })
    };
  }

  return {
    allowed: true,
    appOrigin: policy.data.APP_URL,
    headers: origin === null ? { ...safeHeaders } : {
      ...safeHeaders,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
      'Access-Control-Expose-Headers': exposedHeaders
    }
  };
}
