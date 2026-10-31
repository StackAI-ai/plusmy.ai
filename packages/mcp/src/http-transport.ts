import type { McpJsonRpcRequest, McpJsonRpcResponse } from '@plusmy/contracts';
import type { McpRequestResult } from './server';

const MAX_BATCH_SIZE = 50;

type HttpResult = {
  status: 200 | 202 | 400 | 413;
  body?: McpJsonRpcResponse | McpJsonRpcResponse[];
  rateLimit?: McpRequestResult['rateLimit'];
};

type ParsedMessage =
  | { kind: 'request'; request: McpJsonRpcRequest }
  | { kind: 'notification' }
  | { kind: 'invalid' };

function invalidRequest(message = 'Invalid JSON-RPC request.'): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id: null, error: { code: -32600, message } };
}

function parseMessage(value: unknown): ParsedMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method) return { kind: 'invalid' };
  if ('params' in message && (!message.params || typeof message.params !== 'object' || Array.isArray(message.params))) {
    return { kind: 'invalid' };
  }
  if (!Object.hasOwn(message, 'id')) return { kind: 'notification' };
  if (typeof message.id !== 'string' && !(typeof message.id === 'number' && Number.isSafeInteger(message.id))) {
    return { kind: 'invalid' };
  }
  return { kind: 'request', request: message as unknown as McpJsonRpcRequest };
}

export async function handleMcpHttpPayload(
  payload: unknown,
  dispatch: (request: McpJsonRpcRequest) => Promise<McpRequestResult>
): Promise<HttpResult> {
  const isBatch = Array.isArray(payload);
  const messages = isBatch ? payload : [payload];
  if (messages.length === 0) return { status: 400, body: invalidRequest('JSON-RPC batch must not be empty.') };
  if (messages.length > MAX_BATCH_SIZE) return { status: 413, body: invalidRequest('JSON-RPC batch is too large.') };

  const parsed = messages.map(parseMessage);
  if (isBatch && parsed.some((message) => message.kind === 'request' && message.request.method === 'initialize')) {
    return { status: 400, body: invalidRequest('Initialize must not be batched.') };
  }

  const responses: McpJsonRpcResponse[] = [];
  let rateLimit: McpRequestResult['rateLimit'];
  for (const message of parsed) {
    if (message.kind === 'invalid') {
      responses.push(invalidRequest());
    } else if (message.kind === 'request') {
      const result = await dispatch(message.request);
      responses.push(result.response);
      if (!isBatch) rateLimit = result.rateLimit;
    }
  }

  if (responses.length === 0) return { status: 202 };
  if (isBatch) return { status: 200, body: responses };
  return { status: parsed[0].kind === 'invalid' ? 400 : 200, body: responses[0], rateLimit };
}
