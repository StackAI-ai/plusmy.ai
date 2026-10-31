# MCP Origin guard: draft policy and acceptance gates

## Status and scope

This is an undeployed source-only proposal based on PR1
`19076b0e7726c1a4661dc203b12f4b766770ebea`. It does not approve a production
access policy or configure any environment. The owner must approve the policy
and exact allowed origins before deployment. No named client is certified by
the mock contracts.

The [MCP 2025-06-18 transport security requirements](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning)
require Origin validation. This guard is independent of the negotiated MCP
protocol version; it preserves PR1's stateless handshake, notifications, batches,
and unsupported-SSE behavior. It does not claim full 2025-06-18 conformance.

## Proposed policy

- `APP_URL` is required for `/mcp`, including native clients without Origin. It
  must be an HTTP(S) URL without userinfo, query, fragment, whitespace, or
  backslashes. Its parsed origin is the canonical trusted origin; a path or
  trailing slash in this configured URL does not become part of that origin.
- Missing `Origin` remains supported for non-browser/server-to-server clients.
  An empty header is present and invalid, not a missing header.
- A present Origin must be one exact serialized HTTP(S) origin equal to the
  `APP_URL` origin or an entry in server-only `MCP_ALLOWED_ORIGINS`. It must
  already have canonical URL-origin serialization (lowercase hostname,
  non-default port only, punycode for international names). Ports and schemes
  are significant. No suffix, subdomain, or regular-expression matching occurs.
- `MCP_ALLOWED_ORIGINS` is an optional comma-separated list. Unset or exactly
  empty adds no origins. Whitespace around entries is trimmed. An empty entry,
  wildcard, `null`, URL path/trailing slash, userinfo, query, fragment, opaque
  scheme, or noncanonical origin invalidates the entire configuration; valid
  entries are never partially applied. This list is a draft configuration
  mechanism, not an approved list of production browser clients.
- Requests never supply trust configuration. Request URL, `Host`, `Forwarded`,
  `X-Forwarded-Host`, `X-Forwarded-Proto`, deployment URL variables, and reflected
  Origin values do not add trusted origins. OAuth authentication challenges use
  only the configured `APP_URL` origin.
- Origin is not authentication. Native clients can omit or forge it. Bearer
  token, workspace membership, active approval, scope, and existing tool
  authorization checks remain required and unchanged on POST.

## Route and response contracts

The guard runs before bearer verification, database-backed auth, body parsing,
or MCP dispatch on POST. OPTIONS and unsupported methods also run the guard.
The existing middleware constructs a Supabase SSR client but does not perform
an auth lookup or refresh; it does not supply CORS headers. No global middleware,
OAuth route, provider handler, or token-storage boundary changes in this patch.

| Condition | Result |
| --- | --- |
| Missing/invalid policy configuration, if the route is reached | Generic 503 on every method, no CORS grant or auth challenge |
| Present malformed/disallowed Origin | Generic 403, no CORS grant or auth challenge |
| Accepted OPTIONS (no token required) | Empty 204; fixed allowed methods `POST, OPTIONS` |
| Accepted GET/HEAD/PUT/PATCH/DELETE | 405; `Allow: POST, OPTIONS`; no SSE or session deletion |
| Accepted POST without valid auth/approval | 401; canonical configured resource-metadata challenge |
| Accepted authenticated POST | Existing JSON-RPC statuses; notification-only payload remains empty 202 |

All explicit route responses use `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, and `Vary: Origin`. Only an accepted present
Origin gets an exact `Access-Control-Allow-Origin`; neither wildcard origin nor
`Access-Control-Allow-Credentials` is sent. Native responses need no CORS grant.
Allowed browser origins can send `Authorization`, `Content-Type`, and
`MCP-Protocol-Version` and read `WWW-Authenticate` plus existing `RateLimit-*`
and `X-RateLimit-*` headers. Rate-limit values and JSON-RPC error semantics are
unchanged. Denied Origins never reach tool quota consumption.

Preflight never reflects requested methods/headers or grants private-network
access. A preflight for an unsupported method/header still returns the fixed
allowance, so the browser must reject it. This route remains stateless: session,
resumption, and additional client headers require separate reviewed changes.
Error bodies do not include Origin values, allowlists, configuration validation
details, tokens, or secrets. Framework/proxy failures outside these explicit
handlers must be checked at deployment acceptance. The focused Origin schema
is separate from the shared server-env parser so invalid MCP list configuration
fails closed on `/mcp` without adding a new failure mode to unrelated routes.

## Local regression evidence

The focused suite uses fake signing keys and a throwaway loopback HTTP mock for
Supabase, closed on completion. It needs no live environment, provider account,
migration, or running product server. Test-only process environment overrides
are restored; no `.env.local` or real deployment configuration is written.

```bash
/Users/nickkulavic/.local/bin/laya-route test --route-id 319de7a7-2f92-4cdb-a71c-51f0e2f48c4f -- node --import tsx --test --test-concurrency=2 packages/mcp/tests/http-transport.test.ts apps/web/tests/mcp-route.test.ts apps/web/tests/mcp-origin.test.ts
```

Contracts cover exact canonical/allowlisted origins, absent Origin, hostile and
malformed/null/wildcard/duplicate headers, spoofed URL/Host/forwarding headers,
missing/invalid configuration, fixed preflight, unsupported methods, missing
or invalid bearer tokens, revoked approvals, normal notifications and ping,
parse errors, rate-limited tool headers, and an Origin-less standard SDK
initialize/list/read flow. Denied requests assert no database auth/handler
requests and no body parsing. These are in-process route tests, not browser,
reverse-proxy, deployed-framework, or named-client certification.

## Required approval and certification gates

- [ ] Owner approves whether absent Origin remains allowed and approves the
  exact production browser-Origin list (including whether any extra origins
  are needed at all). Do not infer entries from product names or OAuth client
  registration redirect URIs; those are different trust boundaries.
- [ ] Confirm the canonical HTTPS `APP_URL` in the approved environment and
  alignment with OAuth discovery/issuer/redirect configuration. Existing OAuth
  origin helpers outside `/mcp` still have their own fallback behavior; this
  patch does not certify those routes or change them.
- [ ] Choose preview/local policy explicitly. No `*.vercel.app` wildcard,
  automatic preview/branch URL trust, arbitrary localhost port trust, or
  request-host fallback is supported. If browser access to a preview is
  intended, approve that preview's exact origin and deployment-specific
  canonical URL; do not add preview origins to production by default.
- [ ] At the actual trusted ingress, prove Origin survives proxying unchanged
  and is not stripped, synthesized, or overwritten. Because missing Origin is
  intentionally allowed, stripping it defeats browser-origin rejection.
  Verify duplicate-header handling, denied preflights/POSTs, canonical 401
  metadata, no credentialed CORS, no private-network grants, `Vary: Origin`, and
  no cached authenticated/error responses through the real CDN/proxy.
- [ ] Run a real browser from one approved and one hostile disposable origin;
  verify preflight and readable 401/rate-limit headers. In-process tests do not
  execute browser CORS enforcement or prove Next/proxy header merging.

The disposable CI browser suite also checks a configured localhost origin and a
different loopback origin against the real Next route, including browser CORS
rejection, the unauthenticated challenge, an authenticated MCP call with protocol
headers, and browser-readable rate-limit headers. Existing middleware may reject
malformed environment configuration before the route returns its generic 503.
These tests do not certify a deployed proxy, a named client, or any real account.
- [ ] Certify OpenAI, Anthropic, Gemini, and Cursor independently on approved
  disposable staging accounts. Record client/version, whether requests are
  native/server-to-server or browser-originated, observed Origin and required
  headers without tokens, consent, handshake, notifications, list/read/tools,
  revoked-token rejection, and rate-limit behavior. A client that emits `null`,
  a non-HTTP origin, or an unapproved header remains unsupported pending a
  separate policy review; do not weaken the guard to pass a smoke test.
- [ ] Obtain independent security review of the frozen source; then run the
  approved staging checks and existing release gates before merge/deployment.
  Rollback must be separately authorized and must not silently re-enable
  wildcard CORS or remove Origin validation.
