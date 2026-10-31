import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMcpHttpOrigin, mcpOriginPolicySchema } from '@plusmy/config';

test('MCP Origin policy accepts only exact serialized HTTP(S) origins', () => {
  for (const origin of ['https://app.example', 'http://localhost:3009', 'https://app.example:8443', 'http://127.0.0.1:3009', 'http://[::1]:3009']) {
    assert.equal(isMcpHttpOrigin(origin), true, origin);
  }
  for (const origin of [
    '', 'null', '*', 'https://*.example', 'file:///', 'data:text/plain,hello', 'ftp://app.example',
    'https://app.example/', 'https://app.example/path', 'https://app.example?x=1', 'https://app.example#fragment',
    'https://user:password@app.example', 'https://APP.example', 'https://app.example:443',
    ' https://app.example', 'https://app.example\t', 'https://app.example,https://evil.example',
    'https://app.example https://evil.example', 'https://app.example\\evil', 'https://app,example'
  ]) {
    assert.equal(isMcpHttpOrigin(origin), false, origin);
  }
});

test('MCP configuration derives only APP_URL origin and validates every allowlist entry', () => {
  assert.deepEqual(mcpOriginPolicySchema.parse({ APP_URL: 'https://app.example/base/' }), {
    APP_URL: 'https://app.example', MCP_ALLOWED_ORIGINS: []
  });
  assert.deepEqual(mcpOriginPolicySchema.parse({ APP_URL: 'http://localhost:3009/', MCP_ALLOWED_ORIGINS: '' }), {
    APP_URL: 'http://localhost:3009', MCP_ALLOWED_ORIGINS: []
  });
  assert.deepEqual(mcpOriginPolicySchema.parse({
    APP_URL: 'https://app.example', MCP_ALLOWED_ORIGINS: 'https://client.example, http://localhost:4010'
  }).MCP_ALLOWED_ORIGINS, ['https://client.example', 'http://localhost:4010']);

  for (const APP_URL of [undefined, '', 'null', 'https://*.example', 'file:///tmp', 'https:app.example',
    'https://user:password@app.example', 'https://app.example?token=secret', 'https://app.example#fragment']) {
    assert.equal(mcpOriginPolicySchema.safeParse({ APP_URL }).success, false, String(APP_URL));
  }
  for (const MCP_ALLOWED_ORIGINS of ['*', 'null', ' ', 'https://client.example/', 'https://*.example',
    'https://client.example,', ',https://client.example', 'https://client.example,,https://other.example',
    'https://client.example null', '["https://client.example"]', 'https://client.example,https://user:secret@evil.example']) {
    assert.equal(mcpOriginPolicySchema.safeParse({ APP_URL: 'https://app.example', MCP_ALLOWED_ORIGINS }).success, false, MCP_ALLOWED_ORIGINS);
  }
});
