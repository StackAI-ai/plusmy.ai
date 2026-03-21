# AGENTS.md

## Scope
These instructions apply to `apps/web`.

## Priorities
- `apps/web` is the primary shipping surface for v1.
- Preserve App Router structure and Node runtime routes for OAuth, MCP, and provider callbacks.
- Keep pages workspace-aware by honoring the `workspace` query parameter.

## Product expectations
- Onboarding, workspaces, connections, context, audit, MCP clients, and MCP setup should reflect live workspace state.
- Workspace-scoped mutations must enforce owner/admin checks.
- Personal connections may be user-managed; workspace connections require elevated access.

## Integration rules
- Keep OAuth callback flows consistent with the provider registry in `packages/integrations`.
- Keep MCP/OAuth routes aligned with contracts in `packages/contracts` and services in `packages/core`.
