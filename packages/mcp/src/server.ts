import type { Json, McpJsonRpcRequest, McpJsonRpcResponse, McpResourceDefinition, McpToolDefinition, ProviderId } from '@plusmy/contracts';
import { getIntegration, getIntegrations } from '@plusmy/integrations';
import {
  consumeRateLimit,
  listWorkspaceResources,
  logAuditEvent,
  readWorkspaceResource,
  recordToolInvocation,
  resolveProviderExecutionContext,
  type McpAuthContext
} from '@plusmy/core';

export function createMcpServer(authContext: McpAuthContext) {
  return {
    authContext,
    name: 'plusmy.ai',
    version: '0.1.0'
  };
}

export async function resolveAvailableTools(authContext: McpAuthContext) {
  const tools: McpToolDefinition[] = [];
  for (const integration of getIntegrations()) {
    try {
      const { connection } = await resolveProviderExecutionContext(authContext.workspaceId, authContext.userId, integration.id);
      const providerTools = await integration.listTools(connection);
      tools.push(...providerTools);
    } catch {
      continue;
    }
  }
  return tools;
}

export async function resolveAvailableResources(authContext: McpAuthContext) {
  return await listWorkspaceResources(authContext.workspaceId, authContext.userId);
}

export async function executeToolCall(authContext: McpAuthContext, toolName: string, input: Record<string, unknown>) {
  const [providerSegment] = toolName.split('.');
  const provider = providerSegment as ProviderId;
  const integration = getIntegration(provider);
  if (!integration) {
    throw new Error(`Unknown provider for tool ${toolName}.`);
  }

  const rateLimit = await consumeRateLimit({
    workspaceId: authContext.workspaceId,
    subject: authContext.clientId,
    action: toolName,
    windowSeconds: 60,
    limit: 60
  });

  if (!rateLimit.allowed) {
    throw new Error(`Rate limit exceeded for ${toolName}.`);
  }

  const startedAt = Date.now();
  const { connection, credentials } = await resolveProviderExecutionContext(authContext.workspaceId, authContext.userId, provider);

  try {
    const output = await integration.callTool(toolName, input, { connection, credentials });
    await recordToolInvocation({
      workspaceId: authContext.workspaceId,
      connectionId: connection.id,
      provider,
      toolName,
      status: 'success',
      latencyMs: Date.now() - startedAt,
      requestPayload: input,
      responsePayload: output as Record<string, unknown>
    });
    await logAuditEvent({
      workspaceId: authContext.workspaceId,
      actorType: 'mcp_client',
      actorUserId: authContext.userId,
      actorClientId: authContext.clientId,
      action: 'mcp.tool.called',
      resourceType: 'tool',
      resourceId: toolName,
      metadata: { provider }
    });
    return output;
  } catch (error) {
    await recordToolInvocation({
      workspaceId: authContext.workspaceId,
      connectionId: connection.id,
      provider,
      toolName,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      requestPayload: input,
      errorMessage: error instanceof Error ? error.message : 'Tool execution failed.'
    });
    throw error;
  }
}

function success(id: string | number | null, result: Json): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: string | number | null, code: number, message: string, data?: Json): McpJsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

export async function handleMcpJsonRpcRequest(authContext: McpAuthContext, body: McpJsonRpcRequest): Promise<McpJsonRpcResponse> {
  try {
    switch (body.method) {
      case 'initialize':
        return success(body.id, {
          protocolVersion: '2025-03-26',
          serverInfo: { name: 'plusmy.ai', version: '0.1.0' },
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false }
          }
        });
      case 'ping':
        return success(body.id, {});
      case 'tools/list': {
        const tools = await resolveAvailableTools(authContext);
        return success(body.id, { tools } as unknown as Json);
      }
      case 'resources/list': {
        const resources = await resolveAvailableResources(authContext);
        return success(body.id, { resources } as unknown as Json);
      }
      case 'resources/read': {
        const uri = String(body.params?.uri ?? '');
        const contents = await readWorkspaceResource(authContext.workspaceId, authContext.userId, uri);
        return success(body.id, { contents } as unknown as Json);
      }
      case 'tools/call': {
        const name = String(body.params?.name ?? '');
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
        const output = await executeToolCall(authContext, name, args);
        return success(body.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2)
            }
          ],
          structuredContent: output as Json
        });
      }
      default:
        return failure(body.id, -32601, `Method not found: ${body.method}`);
    }
  } catch (error) {
    return failure(body.id, -32000, error instanceof Error ? error.message : 'MCP request failed.');
  }
}
