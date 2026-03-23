# Operator accessibility and responsive audit

Date: 2026-03-21

Scope:
- Dashboard
- Connections
- Context
- MCP clients
- Audit
- Workspace management

Checks performed:
- Confirmed the primary navigation, workspace switcher, and form controls remain keyboard reachable.
- Confirmed visible labels exist for the main select, text input, textarea, and action controls.
- Confirmed status feedback uses live regions where the UI emits asynchronous responses.
- Confirmed the main card grids, flex-wrap layouts, and long-value containers collapse cleanly at narrower widths.

Notes:
- The operator shell already uses shared UI primitives with predictable focus states.
- Responsive behavior is driven by the existing card/grid/flex layout system, so the remaining work is mostly regression monitoring rather than structural rework.

Follow-up:
- Keep future operator UI changes aligned with the shared primitive layer and preserve visible labels for any new controls.
- If a new icon-only control is added, require an explicit `aria-label` before merge.
