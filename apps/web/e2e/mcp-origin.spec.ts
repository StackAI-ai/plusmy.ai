import { expect, test } from '@playwright/test';

test('MCP browser CORS accepts the configured origin and rejects a different origin', async ({ browser, request }) => {
  const trusted = await browser.newPage();
  const untrusted = await browser.newPage();
  try {
    await trusted.goto('http://localhost:3009/login');
    const allowed = await trusted.evaluate(async () => {
      const response = await fetch('http://127.0.0.1:3009/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
      });
      return { status: response.status, challenge: response.headers.get('www-authenticate') };
    });
    expect(allowed.status).toBe(401);
    expect(allowed.challenge).toContain('http://localhost:3009/.well-known/oauth-protected-resource');

    const rejected = await request.post('/mcp', {
      headers: { origin: 'http://127.0.0.1:3009' },
      data: { jsonrpc: '2.0', id: 1, method: 'ping' }
    });
    expect(rejected.status()).toBe(403);
    expect(rejected.headers()['access-control-allow-origin']).toBeUndefined();

    await untrusted.goto('http://127.0.0.1:3009/login');
    expect(new URL(untrusted.url()).origin).toBe('http://127.0.0.1:3009');
    const browserRejected = await untrusted.evaluate(async () => {
      try {
        await fetch('http://localhost:3009/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(browserRejected).toBe(true);
  } finally {
    await trusted.close();
    await untrusted.close();
  }
});
