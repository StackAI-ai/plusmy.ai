# AGENTS.md

## Scope
These instructions apply to `apps/mobile`.

## Priorities
- Mobile is scaffold-first until parity is explicitly requested.
- Prefer read-only or lightweight operator experiences that reuse shared contracts and Supabase clients.
- Do not introduce mobile-only domain logic if it belongs in `packages/core` or `packages/contracts`.

## Constraints
- Keep Expo configuration simple.
- Match the current workspace model and shared auth assumptions from the web app.
