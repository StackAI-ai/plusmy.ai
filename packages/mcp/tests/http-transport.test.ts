import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMcpHttpPayload } from '../src/http-transport';
import type { McpJsonRpcRequest } from '@plusmy/contracts';

function dispatcher(seen: McpJsonRpcRequest[]) {
  return async (request: McpJsonRpcRequest) => {
    seen.push(request);
    return {
      response: { jsonrpc: '2.0' as const, id: request.id, result: { method: request.method } },
      rateLimit: { limit: 60, remaining: 59, resetAt: 100, resetAfterSeconds: 60 }
    };
  };
}

test('accepts initialized notifications without dispatching or sending a JSON-RPC response', async () => {
  const seen: McpJsonRpcRequest[] = [];
  const result = await handleMcpHttpPayload(
    { jsonrpc: '2.0', method: 'notifications/initialized' }, dispatcher(seen)
  );
  assert.deepEqual(result, { status: 202 });
  assert.deepEqual(seen, []);
});

test('dispatches single requests and retains their rate-limit metadata', async () => {
  const seen: McpJsonRpcRequest[] = [];
  const request = { jsonrpc: '2.0', id: 1, method: 'ping' } as const;
  const result = await handleMcpHttpPayload(request, dispatcher(seen));
  assert.deepEqual(seen, [request]);
  assert.deepEqual(result, {
    status: 200,
    body: { jsonrpc: '2.0', id: 1, result: { method: 'ping' } },
    rateLimit: { limit: 60, remaining: 59, resetAt: 100, resetAfterSeconds: 60 }
  });
});

test('returns only request and invalid-item responses for a mixed batch', async () => {
  const seen: McpJsonRpcRequest[] = [];
  const result = await handleMcpHttpPayload([
    { jsonrpc: '2.0', id: 'one', method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: null, method: 'ping' },
    { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} }
  ], dispatcher(seen));
  assert.deepEqual(seen.map((request) => request.id), ['one', 2]);
  assert.deepEqual(result, {
    status: 200,
    body: [
      { jsonrpc: '2.0', id: 'one', result: { method: 'ping' } },
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } },
      { jsonrpc: '2.0', id: 2, result: { method: 'resources/list' } }
    ]
  });
});

test('rejects malformed messages and bounded or illegal batches without dispatch', async () => {
  const seen: McpJsonRpcRequest[] = [];
  for (const value of [
    null,
    { jsonrpc: '2.0', id: null, method: 'ping' },
    { jsonrpc: '2.0', id: 1.5, method: 'ping' },
    { jsonrpc: '2.0', id: 1, method: 'ping', params: [] },
    [],
    [{ jsonrpc: '2.0', id: 1, method: 'initialize' }]
  ]) {
    const result = await handleMcpHttpPayload(value, dispatcher(seen));
    assert.equal(result.status, 400);
    assert.ok(!Array.isArray(result.body) && result.body?.error?.code === -32600);
  }
  const oversized = await handleMcpHttpPayload(Array.from({ length: 51 }, () => ({ jsonrpc: '2.0', method: 'ping' })), dispatcher(seen));
  assert.equal(oversized.status, 413);
  assert.deepEqual(seen, []);
});

test('accepts notification-only batches without a response body', async () => {
  const seen: McpJsonRpcRequest[] = [];
  const result = await handleMcpHttpPayload([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'notifications/roots/list_changed' }
  ], dispatcher(seen));
  assert.deepEqual(result, { status: 202 });
  assert.deepEqual(seen, []);
});
