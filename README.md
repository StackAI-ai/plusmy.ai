# plusmy.ai

`plusmy.ai` is a centralized AI integration hub, secret vault, and universal context manager for teams.

## Stack

- Turborepo monorepo
- Next.js App Router on Vercel
- Expo mobile scaffold
- Supabase Auth + Postgres + Vault + pgvector + pgmq
- OAuth-native MCP server over HTTP

## Workspace layout

- `apps/web`: primary product surface and MCP/OAuth endpoints
- `apps/mobile`: Expo scaffold wired to shared contracts
- `packages/contracts`: shared domain types and MCP DTOs
- `packages/config`: environment parsing and runtime configuration
- `packages/supabase`: shared Supabase clients and database types
- `packages/core`: OAuth, tenancy, secrets, and token lifecycle services
- `packages/integrations`: provider abstraction layer and v1 adapters
- `packages/mcp`: MCP request handling and tool/resource resolution
- `supabase/`: migrations, config, and internal worker functions

## First steps

1. Copy `.env.example` to `.env.local` and fill Supabase plus provider credentials.
2. Install dependencies with `pnpm install`.
3. Run the web app with `pnpm dev:web`.
4. Start Supabase locally with `pnpm supabase:start` if you want local database development.
5. Apply migrations with `supabase db reset` or `supabase migration up`.

## Product slices implemented in this scaffold

- Team workspaces with shared and personal connections
- Secure token storage via Vault secret references only
- OAuth 2.1 authorization server endpoints for MCP clients
- Dynamic MCP tool resolution for Google, Slack, and Notion
- Context/prompt/skill resources backed by Postgres and pgvector RPC hooks
- Audit logging and Postgres-native rate limiting hooks
