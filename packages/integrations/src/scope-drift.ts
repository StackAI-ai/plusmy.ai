import type { McpToolDefinition } from '@plusmy/contracts';
import type { ToolScopeDrift } from './types';

function normalizeScopes(scopes: string[] | null | undefined) {
  return new Set(
    (scopes ?? [])
      .map((scope) => String(scope).trim())
      .filter(Boolean)
  );
}

export function getMissingScopes(requiredScopes: string[] | null | undefined, grantedScopes: string[] | null | undefined) {
  const granted = normalizeScopes(grantedScopes);
  return (requiredScopes ?? [])
    .map((scope) => String(scope).trim())
    .filter(Boolean)
    .filter((scope) => !granted.has(scope));
}

export function hasRequiredToolScopes(tool: McpToolDefinition, grantedScopes: string[] | null | undefined) {
  return getMissingScopes(tool.requiredProviderScopes, grantedScopes).length === 0;
}

export function getToolScopeDrift(tools: McpToolDefinition[], grantedScopes: string[] | null | undefined): ToolScopeDrift[] {
  return tools
    .map((tool) => {
      const missingScopes = getMissingScopes(tool.requiredProviderScopes, grantedScopes);
      if (missingScopes.length === 0) {
        return null;
      }

      return {
        toolName: tool.name,
        toolTitle: tool.title,
        missingScopes
      } satisfies ToolScopeDrift;
    })
    .filter((entry): entry is ToolScopeDrift => entry != null);
}
