# AGENTS.md

## Scope
These instructions apply to `packages/*`.

## Design rules
- Put cross-app logic here, not in app folders.
- Keep contracts stable and framework-agnostic where possible.
- Favor explicit server-side service boundaries in `packages/core`.
- Keep provider-specific behavior inside `packages/integrations`.
- Keep MCP protocol assembly in `packages/mcp`.

## Dependency discipline
- Avoid leaking app-specific UI or routing concerns into shared packages.
- Update `docs/BUILD_PLAN.md` when shared package boundaries materially change.
