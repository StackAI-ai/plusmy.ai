#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';

const baseUrl = new URL(process.env.MCP_COMPAT_BASE_URL ?? process.env.MCP_STRESS_BASE_URL ?? 'http://localhost:3009');
const token = process.env.MCP_STRESS_TOKEN ?? process.env.MCP_COMPAT_TOKEN ?? '';
const protocolVersion = '2025-03-26';
const authorizeClientId = process.env.MCP_COMPAT_AUTHORIZE_CLIENT_ID ?? 'plusmy-smoke';
const authorizeRedirectUri = process.env.MCP_COMPAT_AUTHORIZE_REDIRECT_URI ?? `${baseUrl}mcp-compat/callback`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createCodeChallenge(verifier) {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url')
    .replace(/=+$/g, '');
}

async function fetchJson(path, options = {}) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, options);
  const body = await response
    .text()
    .then((text) => {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })
    .catch(() => null);
  return { response, body };
}

function requestWithAuth(method, path, body) {
  return fetchJson(path, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: token ? `Bearer ${token}` : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function createRequest(id, method, params = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params
  };
}

async function run() {
  const discovery = await fetchJson('/.well-known/oauth-authorization-server');
  assert(discovery.response.ok, `OAuth auth-server discovery failed: HTTP ${discovery.response.status}`);
  const discoveryBody = discovery.body;
  assert(discoveryBody?.authorization_endpoint, 'OAuth discovery is missing authorization_endpoint');
  assert(discoveryBody?.token_endpoint, 'OAuth discovery is missing token_endpoint');

  const protectedResource = await fetchJson('/.well-known/oauth-protected-resource');
  assert(
    protectedResource.response.ok,
    `OAuth protected-resource discovery failed: HTTP ${protectedResource.response.status}`
  );
  assert(protectedResource.body?.resource ?? protectedResource.body?.authorization_servers, 'Protected-resource discovery is malformed');

  const verifier = randomBytes(64).toString('base64url');
  const challenge = createCodeChallenge(verifier);
  const authorizeUrl = new URL('/authorize', baseUrl);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', authorizeClientId);
  authorizeUrl.searchParams.set('redirect_uri', authorizeRedirectUri);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('scope', 'mcp:tools mcp:resources');
  authorizeUrl.searchParams.set('state', randomBytes(8).toString('hex'));

  const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
  assert(
    [302, 303, 400, 401, 403, 500].includes(authorizeResponse.status),
    `Authorize endpoint returned unexpected status ${authorizeResponse.status}`
  );

  const registerResponse = await fetchJson('/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'plusmy Compatibility Test',
      redirect_uris: [authorizeRedirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    })
  });
  if (registerResponse.response.status === 201) {
    assert(typeof registerResponse.body?.client_id === 'string', 'Register response missing client_id');
    assert(Array.isArray(registerResponse.body?.redirect_uris), 'Register response missing redirect_uris');
  } else {
    assert(
      [401, 403, 500].includes(registerResponse.response.status),
      `Register endpoint returned unexpected status ${registerResponse.response.status}`
    );
  }

  const tokenResponse = await fetchJson('/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: '00000000-0000-0000-0000-000000000000',
      redirect_uri: authorizeRedirectUri,
      code_verifier: verifier,
      client_id: authorizeClientId
    })
  });
  assert(
    tokenResponse.response.status >= 400,
    `Token exchange is unexpectedly accepting a placeholder auth code with status ${tokenResponse.response.status}`
  );

  if (!token) {
    console.log('Skipping /mcp transport checks: MCP_STRESS_TOKEN/MCP_COMPAT_TOKEN not set.');
    return;
  }

  const initialize = await requestWithAuth('POST', '/mcp', createRequest('compat-init', 'initialize', { protocolVersion }));
  assert(initialize.response.ok, `/mcp initialize failed: HTTP ${initialize.response.status}`);
  assert(initialize.body?.result?.serverInfo?.name, 'MCP initialize response missing serverInfo');

  const toolsResponse = await requestWithAuth('POST', '/mcp', createRequest('compat-tools', 'tools/list'));
  assert(toolsResponse.response.ok, `/mcp tools/list failed: HTTP ${toolsResponse.response.status}`);
  assert(Array.isArray(toolsResponse.body?.result?.tools), 'MCP tools/list did not return a tool array');

  const resourcesResponse = await requestWithAuth('POST', '/mcp', createRequest('compat-resources', 'resources/list'));
  assert(resourcesResponse.response.ok, `/mcp resources/list failed: HTTP ${resourcesResponse.response.status}`);
  assert(Array.isArray(resourcesResponse.body?.result?.resources), 'MCP resources/list did not return a resource array');

  console.log(`MCP compatibility smoke checks passed against ${baseUrl} with bearer token and OAuth discovery validation.`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
