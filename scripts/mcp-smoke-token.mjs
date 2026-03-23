#!/usr/bin/env node

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_FIXTURE = {
  userId: '11111111-1111-1111-1111-111111111111',
  workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  clientId: 'plusmy-smoke-fixture',
  scopes: ['mcp:tools', 'mcp:resources'],
  expiresInSeconds: 900
};

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return new Map();
  const values = new Map();
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }
  return values;
}

function resolveSecret() {
  if (process.env.MCP_JWT_SECRET) return process.env.MCP_JWT_SECRET;
  const envLocal = readEnvFile(resolve(process.cwd(), 'apps/web/.env.local'));
  return envLocal.get('MCP_JWT_SECRET') ?? null;
}

function resolveFixtureClaims() {
  const scopes =
    process.env.MCP_SMOKE_SCOPES?.split(' ').filter(Boolean) ?? DEFAULT_FIXTURE.scopes;
  return {
    userId: process.env.MCP_SMOKE_USER_ID ?? DEFAULT_FIXTURE.userId,
    workspaceId: process.env.MCP_SMOKE_WORKSPACE_ID ?? DEFAULT_FIXTURE.workspaceId,
    clientId: process.env.MCP_SMOKE_CLIENT_ID ?? DEFAULT_FIXTURE.clientId,
    scopes,
    expiresInSeconds: Number(process.env.MCP_SMOKE_EXPIRES_IN ?? DEFAULT_FIXTURE.expiresInSeconds)
  };
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function signJwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(unsignedToken).digest('base64url');
  return `${unsignedToken}.${signature}`;
}

export async function resolveMcpSmokeToken(providedToken, { allowMissing = false } = {}) {
  if (providedToken) {
    return { token: providedToken, source: 'env' };
  }

  const secret = resolveSecret();
  if (!secret) {
    if (allowMissing) return { token: '', source: 'missing' };
    throw new Error('MCP_JWT_SECRET is required to mint a smoke-test token.');
  }

  const claims = resolveFixtureClaims();
  const now = Math.floor(Date.now() / 1000);
  const token = signJwtHS256(
    {
      sub: claims.userId,
      aud: 'plusmy:mcp',
      iat: now,
      exp: now + claims.expiresInSeconds,
      workspace_id: claims.workspaceId,
      user_id: claims.userId,
      client_id: claims.clientId,
      scope: claims.scopes.join(' ')
    },
    secret
  );

  return { token, source: 'fixture' };
}
