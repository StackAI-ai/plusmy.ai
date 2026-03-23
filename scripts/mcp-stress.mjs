#!/usr/bin/env node

const baseUrl = process.env.MCP_STRESS_BASE_URL ?? 'http://localhost:3009';
const token = process.env.MCP_STRESS_TOKEN ?? '';
const requestCount = Number(process.env.MCP_STRESS_REQUEST_COUNT ?? 12);
const requestBatchSize = Math.max(Number.isFinite(requestCount) ? Math.trunc(requestCount) : 12, 1);
const protocolVersion = '2025-03-26';

if (!token) {
  console.error('MCP_STRESS_TOKEN is required.');
  process.exit(1);
}

function createRequest(id, method, params = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params
  };
}

async function postJson(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${path}`);
  }

  return payload;
}

async function runBatch(label) {
  const initialize = await postJson('/mcp', createRequest(`${label}-init`, 'initialize', { protocolVersion }));
  if (!initialize?.result?.serverInfo?.name) {
    throw new Error('initialize response missing serverInfo');
  }

  const requests = Array.from({ length: requestBatchSize }, (_, index) => {
    const method = index % 2 === 0 ? 'tools/list' : 'resources/list';
    return postJson('/mcp', createRequest(`${label}-${index}`, method));
  });

  const responses = await Promise.all(requests);
  const toolList = responses.find((payload) => Array.isArray(payload?.result?.tools)) ?? null;
  const resourceList = responses.find((payload) => Array.isArray(payload?.result?.resources)) ?? null;
  const resources = resourceList?.result?.resources ?? [];

  if (!toolList) {
    throw new Error('tools/list did not return a tool array');
  }

  if (!resourceList) {
    throw new Error('resources/list did not return a resource array');
  }

  if (resources.length > 0) {
    const firstResource = resources[0];
    const readResponse = await postJson('/mcp', createRequest(`${label}-read`, 'resources/read', { uri: firstResource.uri }));
    const contents = readResponse?.result?.contents ?? [];
    if (!Array.isArray(contents) || contents.length === 0) {
      throw new Error('resources/read did not return any contents');
    }
  }
}

async function main() {
  await runBatch('first');
  await new Promise((resolve) => setTimeout(resolve, 250));
  await runBatch('second');
  console.log(`MCP stress check passed against ${baseUrl} with batch size ${requestBatchSize}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
