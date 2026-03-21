# Platform Catalog

This repo currently supports three provider integrations in production:

- Google Workspace for Drive and Docs read/search
- Slack for channel history, channel discovery, and posting
- Notion for search, page read, and page creation

That is the live surface today. Everything else below is the suggested expansion plan for the next product slices.

## What Fits Next

The highest-leverage missing platforms are the ones that already map cleanly to the existing OAuth, workspace-scoped connection, and context-ingestion model:

- Microsoft 365 for Outlook, OneDrive, SharePoint, Word, and Teams
- GitHub for repo, issue, pull request, and code search workflows
- Jira and Linear for issue tracking and delivery context
- HubSpot and Salesforce for CRM and customer-success context
- Zendesk for support-ticket workflows
- Confluence for enterprise knowledge bases

These are the most obvious additions because they broaden coverage across collaboration, customer operations, and engineering without changing the core runtime shape.

## Lower-Priority Expansions

After the first enterprise suite and ops layers land, the next candidates are:

- Snowflake and BigQuery for governed analytics access
- Box and Dropbox for document-heavy storage use cases
- Datadog for incident and observability context

These are valuable, but they usually need stricter permission, query, or rate-limit handling than the first-wave collaboration tools.

## Source Of Truth

The typed catalog for this planning view lives in [`/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts`](/Users/nickkulavic/Projects/plusmy.ai/packages/contracts/src/platform-catalog.ts).

Keep this list aligned with the product plan when new provider adapters or supported client surfaces are added.
