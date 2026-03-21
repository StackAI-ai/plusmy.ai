# Platform Catalog

The live provider surface in this repo is still intentionally small:

- Google Workspace for Drive search and Docs read
- Slack for channel listing, history read, and post-message workflows
- Notion for search, page read, and page creation

The MCP client target set currently called out in product surfaces is:

- OpenAI-compatible MCP clients
- Anthropic-compatible MCP clients
- Gemini-adjacent MCP clients
- Cursor and similar coding-agent clients

## Why These Platforms Fit

Each live provider already conforms to the same product model:

- Workspace-scoped or personal installs
- OAuth credentials stored in Vault-backed secret references
- MCP tool exposure gated by workspace membership and approval state
- Reauth, sync, and audit visibility on the operator surface

The next-wave platforms were chosen because they fit that same model without requiring a different security posture.

## Next-Wave Expansion Candidates

Highest-value reviewed gaps by category:

- Documents and storage: Microsoft 365, Dropbox, and Box
- Engineering and knowledge: GitHub, Linear, Jira, and Confluence
- Project management: Asana and monday.com
- CRM and customer ops: HubSpot and Salesforce
- Support and service management: Zendesk and ServiceNow
- Productivity and identity: Airtable, Zoom, and Okta

These next-wave platforms stay aligned with the same tenant model as the live providers: workspace-scoped installs, Vault-backed credentials, MCP-gated tools, and explicit audit/re-auth boundaries.

## Source Of Truth

The typed source of truth for app and docs surfaces lives in [`/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts`](/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts).

When a provider adapter ships, move it from planned to live in that file and update the build plan in the same change set.
