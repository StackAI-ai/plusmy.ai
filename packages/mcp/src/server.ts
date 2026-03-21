import type {
  ContextInjectionResult,
  Json,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpResourceDefinition,
  McpToolDefinition,
  ProviderId
} from '@plusmy/contracts';
import { getIntegration, getIntegrations } from '@plusmy/integrations';
import {
  consumeRateLimit,
  listWorkspaceResources,
  logAuditEvent,
  readWorkspaceResourceWithContext,
  recordToolInvocation,
  resolveContextInjection,
  resolveProviderRuntimeContext,
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

function summarizeRuntimeContext(runtimeContext: Awaited<ReturnType<typeof resolveProviderRuntimeContext>>) {
  return {
    promptCount: runtimeContext.prompts.length,
    skillCount: runtimeContext.skills.length,
    resourceUris: runtimeContext.resources.map((resource) => resource.uri)
  };
}

function summarizeContextInjection(contextInjection: ContextInjectionResult) {
  return {
    query: contextInjection.query,
    matchCount: contextInjection.matches.length,
    assetTitles: contextInjection.matches.map((match) => match.title)
  };
}

function truncateText(value: string, maxChars = 480) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatContextInjectionMarkdown(heading: string, contextInjection: ContextInjectionResult) {
  if (contextInjection.matches.length === 0) {
    return null;
  }

  const sections = [heading];
  for (const [index, match] of contextInjection.matches.entries()) {
    const similarity = Number.isFinite(match.similarity) ? `${Math.round(match.similarity * 100)}% match` : 'matched context';
    sections.push(`## ${index + 1}. ${match.title}\n\n${similarity}\n\n${truncateText(match.content)}`);
  }

  return sections.join('\n\n');
}

function formatRuntimeContextMarkdown(runtimeContext: Awaited<ReturnType<typeof resolveProviderRuntimeContext>>) {
  if (runtimeContext.prompts.length === 0 && runtimeContext.skills.length === 0) {
    return null;
  }

  const sections = ['# plusmy.ai Runtime Context'];
  if (runtimeContext.prompts.length > 0) {
    sections.push(`Bound prompts: ${runtimeContext.prompts.map((prompt) => prompt.name).join(', ')}`);
  }
  if (runtimeContext.skills.length > 0) {
    sections.push(`Bound skills: ${runtimeContext.skills.map((skill) => skill.name).join(', ')}`);
  }
  return sections.join('\n\n');
}

function withRuntimeContextHint(
  tool: McpToolDefinition,
  runtimeContext: Awaited<ReturnType<typeof resolveProviderRuntimeContext>>
): McpToolDefinition {
  const promptLabel = runtimeContext.prompts.length === 1 ? '1 bound prompt' : `${runtimeContext.prompts.length} bound prompts`;
  const skillLabel = runtimeContext.skills.length === 1 ? '1 bound skill' : `${runtimeContext.skills.length} bound skills`;
  return {
    ...tool,
    description:
      runtimeContext.resources.length === 0
        ? `${tool.description} plusmy.ai can attach matched workspace context snippets when relevant.`
        : `${tool.description} Runtime context: ${promptLabel}, ${skillLabel}. plusmy.ai can also attach matched workspace context snippets when relevant.`
  };
}

export async function resolveAvailableTools(authContext: McpAuthContext) {
  const tools: McpToolDefinition[] = [];
  for (const integration of getIntegrations()) {
    try {
      const { connection } = await resolveProviderExecutionContext(authContext.workspaceId, authContext.userId, integration.id);
      const providerTools = await integration.listTools(connection);
      const contextAwareTools = await Promise.all(
        providerTools.map(async (tool) =>
          withRuntimeContextHint(
            tool,
            await resolveProviderRuntimeContext(authContext.workspaceId, authContext.userId, {
              provider: integration.id,
              toolName: tool.name
            })
          )
        )
      );
      tools.push(...contextAwareTools);
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
    await logAuditEvent({
      workspaceId: authContext.workspaceId,
      actorType: 'mcp_client',
      actorUserId: authContext.userId,
      actorClientId: authContext.clientId,
      action: 'mcp.tool.rate_limited',
      resourceType: 'tool',
      resourceId: toolName,
      status: 'error',
      metadata: { provider }
    });
    throw new Error(`Rate limit exceeded for ${toolName}.`);
  }

  const startedAt = Date.now();
  const { connection, credentials } = await resolveProviderExecutionContext(authContext.workspaceId, authContext.userId, provider);
  const availableTools = await integration.listTools(connection);
  const toolDefinition = availableTools.find((tool) => tool.name === toolName);
  const runtimeContext = await resolveProviderRuntimeContext(authContext.workspaceId, authContext.userId, {
    provider,
    toolName
  });
  const contextInjection = await resolveContextInjection(
    authContext.workspaceId,
    [toolName, toolDefinition?.title ?? null, toolDefinition?.description ?? null, JSON.stringify(input)],
    3
  );

  try {
    const output = await integration.callTool(toolName, input, { connection, credentials, runtimeContext });
    await recordToolInvocation({
      workspaceId: authContext.workspaceId,
      connectionId: connection.id,
      actorUserId: authContext.userId,
      actorClientId: authContext.clientId,
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
      metadata: {
        provider,
        runtimeContext: summarizeRuntimeContext(runtimeContext),
        contextInjection: summarizeContextInjection(contextInjection)
      }
    });
    return { output, runtimeContext, contextInjection };
  } catch (error) {
    await recordToolInvocation({
      workspaceId: authContext.workspaceId,
      connectionId: connection.id,
      actorUserId: authContext.userId,
      actorClientId: authContext.clientId,
      provider,
      toolName,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      requestPayload: input,
      errorMessage: error instanceof Error ? error.message : 'Tool execution failed.'
    });
    await logAuditEvent({
      workspaceId: authContext.workspaceId,
      actorType: 'mcp_client',
      actorUserId: authContext.userId,
      actorClientId: authContext.clientId,
      action: 'mcp.tool.failed',
      resourceType: 'tool',
      resourceId: toolName,
      status: 'error',
      metadata: {
        provider,
        runtimeContext: summarizeRuntimeContext(runtimeContext),
        contextInjection: summarizeContextInjection(contextInjection),
        error: error instanceof Error ? error.message : 'Tool execution failed.'
      }
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
        const { contents, contextInjection, resourceName } = await readWorkspaceResourceWithContext(authContext.workspaceId, authContext.userId, uri);
        const supplementalContext = formatContextInjectionMarkdown(
          `# Relevant Workspace Context${resourceName ? ` for ${resourceName}` : ''}`,
          contextInjection
        );
        return success(
          body.id,
          {
            contents: supplementalContext
              ? [
                  ...contents,
                  {
                    uri: `${uri}#context`,
                    mimeType: 'text/markdown',
                    text: supplementalContext
                  }
                ]
              : contents
          } as unknown as Json
        );
      }
      case 'tools/call': {
        const name = String(body.params?.name ?? '');
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
        const { output, runtimeContext, contextInjection } = await executeToolCall(authContext, name, args);
        const supplementalBlocks = [
          formatRuntimeContextMarkdown(runtimeContext),
          formatContextInjectionMarkdown('# Matched Workspace Context', contextInjection)
        ].filter((block): block is string => Boolean(block));
        return success(body.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2)
            },
            ...supplementalBlocks.map((text) => ({
              type: 'text' as const,
              text
            }))
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
