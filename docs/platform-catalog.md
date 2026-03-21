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

Highest-value reviewed gaps:

- Microsoft 365 for OneDrive and SharePoint parity
- GitHub for repository, issue, and pull-request workflows
- Linear and Jira for issue-tracking integration
- Confluence for enterprise knowledge search
- HubSpot and Salesforce for CRM context
- Zendesk for customer-support workflows
- Dropbox for storage-heavy teams
- Airtable for operational table read/write workflows

## Source Of Truth

The typed source of truth for app and docs surfaces lives in [`/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts`](/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts).

When a provider adapter ships, move it from planned to live in that file and update the build plan in the same change set.
