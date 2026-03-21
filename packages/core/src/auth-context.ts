import { createHash } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { NextRequest } from 'next/server';
import { getServerEnv } from '@plusmy/config';

const encoder = new TextEncoder();

export interface McpAccessTokenClaims {
  sub: string;
  clientId: string;
  workspaceId: string;
  userId: string;
  scopes: string[];
}

export interface McpAuthContext extends McpAccessTokenClaims {}

interface ProviderStateClaims {
  provider: string;
  userId: string;
  workspaceId: string;
  connectionScope: 'workspace' | 'personal';
  redirectTo: string;
}

function secret() {
  return encoder.encode(getServerEnv().MCP_JWT_SECRET);
}

export function hashOpaqueToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function issueMcpAccessToken(claims: McpAccessTokenClaims, expiresInSeconds = 900) {
  return await new SignJWT({
    workspace_id: claims.workspaceId,
    user_id: claims.userId,
    client_id: claims.clientId,
    scope: claims.scopes.join(' ')
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setAudience('plusmy:mcp')
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(secret());
}

export async function verifyMcpAccessToken(token: string): Promise<McpAuthContext | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: 'plusmy:mcp' });
    return {
      sub: String(payload.sub ?? ''),
      clientId: String(payload.client_id ?? ''),
      workspaceId: String(payload.workspace_id ?? ''),
      userId: String(payload.user_id ?? ''),
      scopes: String(payload.scope ?? '').split(' ').filter(Boolean)
    };
  } catch {
    return null;
  }
}

export async function resolveMcpAuthContextFromRequest(request: Request | NextRequest) {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return await verifyMcpAccessToken(header.slice(7));
}

export async function signProviderState(claims: ProviderStateClaims) {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret());
}

export async function verifyProviderState(token: string): Promise<ProviderStateClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      provider: String(payload.provider ?? ''),
      userId: String(payload.userId ?? ''),
      workspaceId: String(payload.workspaceId ?? ''),
      connectionScope: payload.connectionScope === 'personal' ? 'personal' : 'workspace',
      redirectTo: String(payload.redirectTo ?? '/connections')
    };
  } catch {
    return null;
  }
}
