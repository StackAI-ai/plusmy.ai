# Platform Catalog

The live provider surface in this repo now includes these production integrations:

- Google Workspace for Drive search and Docs read
- Slack for channel listing, history read, and post-message workflows
- Notion for search, page read, and page creation
- Dropbox for file search and file reads
- Box for enterprise file search and file reads
- Airtable for operational-table search, record reads, and controlled writes
- Zoom for meeting discovery, recording visibility, and transcript reads
- HubSpot for CRM contact and company access
- Salesforce for enterprise CRM account workflows
- ServiceNow for incident and service-request workflows
- Okta for identity and group visibility
- Asana for task and comment workflows
- monday.com for board-centric operations
- Microsoft 365 for OneDrive and SharePoint document workflows
- GitHub for repository and issue workflows
- Linear for issue search and updates
- Jira for engineering ticket operations
- Confluence for enterprise knowledge search and page reads
- Zendesk for support ticket search and comments
- QuickBooks Online for customer and invoice workflows
- Xero for contact and invoice workflows

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

The immediate private-beta focus is no longer adding more catalog entries first. The work now shifts to:

1. Provider validation and reliability hardening
1. AI-client onboarding and approval polish
1. Context quality, search, and runtime grounding

## Source Of Truth

The typed source of truth for app and docs surfaces lives in [`/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts`](/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts).

When a provider adapter ships, move it from planned to live in that file and update the build plan in the same change set.
