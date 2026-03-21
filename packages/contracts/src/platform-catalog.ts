export type PlatformStage = 'current' | 'next' | 'later';

export type PlatformCategory =
  | 'workspace-suite'
  | 'messaging'
  | 'knowledge'
  | 'project-management'
  | 'crm'
  | 'support'
  | 'engineering'
  | 'data'
  | 'storage'
  | 'identity';

export interface PlatformSupportRecord {
  id: string;
  name: string;
  category: PlatformCategory;
  stage: PlatformStage;
  description: string;
  rationale: string;
  primaryUseCases: string[];
  notes?: string;
}

export const currentSupportedPlatforms = [
  {
    id: 'google',
    name: 'Google Workspace',
    category: 'workspace-suite',
    stage: 'current',
    description: 'Drive and Docs read/search support for workspace context and MCP retrieval.',
    rationale: 'Matches the existing OAuth, sync, and context ingestion model.',
    primaryUseCases: ['Drive search', 'Docs read', 'Workspace knowledge retrieval']
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'messaging',
    stage: 'current',
    description: 'Channel listing, history lookup, and message posting.',
    rationale: 'Useful for operational context and fast collaborative action loops.',
    primaryUseCases: ['Channel search', 'Message history', 'Operational posting']
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'knowledge',
    stage: 'current',
    description: 'Search, page read, and page creation for team knowledge bases.',
    rationale: 'Fits the context-library and document-creation flows already in the product.',
    primaryUseCases: ['Knowledge search', 'Page read', 'Page creation']
  }
] as const satisfies readonly PlatformSupportRecord[];

export const nextPlatforms = [
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    category: 'workspace-suite',
    stage: 'next',
    description: 'Outlook, OneDrive, SharePoint, Word, and Teams coverage.',
    rationale: 'Natural enterprise counterpart to Google Workspace and a frequent enterprise ask.',
    primaryUseCases: ['Email context', 'File search', 'Meeting and chat context']
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'engineering',
    stage: 'next',
    description: 'Repository, issue, pull request, and code-search support.',
    rationale: 'Strong fit for engineering orgs using MCP-driven coding and ops workflows.',
    primaryUseCases: ['Code search', 'Issue triage', 'PR context']
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'project-management',
    stage: 'next',
    description: 'Issue search, status updates, and project context.',
    rationale: 'Common enterprise system of record for delivery and escalation workflows.',
    primaryUseCases: ['Ticket lookup', 'Workflow updates', 'Program context']
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'project-management',
    stage: 'next',
    description: 'Issue tracking and lightweight product-ops workflows.',
    rationale: 'Already close to the team workflow and valuable for product-led customers.',
    primaryUseCases: ['Issue search', 'Task updates', 'Sprint context']
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    stage: 'next',
    description: 'CRM contact, company, deal, and activity retrieval.',
    rationale: 'High-value sales and customer-success source of truth for operator workflows.',
    primaryUseCases: ['CRM lookup', 'Deal context', 'Customer activity']
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'support',
    stage: 'next',
    description: 'Ticket search, reply drafting, and customer-support context.',
    rationale: 'Directly improves support-handling and customer escalation loops.',
    primaryUseCases: ['Ticket search', 'Reply drafting', 'Escalation context']
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    stage: 'next',
    description: 'Account, opportunity, and case access for enterprise teams.',
    rationale: 'Enterprise CRM coverage beyond HubSpot for larger customer accounts.',
    primaryUseCases: ['Account lookup', 'Opportunity context', 'Case triage']
  },
  {
    id: 'confluence',
    name: 'Confluence',
    category: 'knowledge',
    stage: 'next',
    description: 'Enterprise wiki and documentation search/read support.',
    rationale: 'Common replacement or complement to Notion inside larger organizations.',
    primaryUseCases: ['Wiki search', 'Page read', 'Runbook context']
  }
] as const satisfies readonly PlatformSupportRecord[];

export const laterPlatforms = [
  {
    id: 'snowflake',
    name: 'Snowflake',
    category: 'data',
    stage: 'later',
    description: 'Warehouse query and governed analytics context.',
    rationale: 'High-value, but usually needs stricter governance and query controls first.',
    primaryUseCases: ['Analyst context', 'Operational metrics', 'Data pulls']
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    category: 'data',
    stage: 'later',
    description: 'Google Cloud warehouse support for analytics teams.',
    rationale: 'Strong strategic fit, but best after the core enterprise suite integrations.',
    primaryUseCases: ['Metrics retrieval', 'Scheduled reports', 'Data discovery']
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    category: 'storage',
    stage: 'later',
    description: 'File search and retrieval for shared storage-heavy teams.',
    rationale: 'Useful, but lower leverage than the first-wave knowledge and collaboration systems.',
    primaryUseCases: ['File search', 'Shared folder context', 'Document retrieval']
  },
  {
    id: 'box',
    name: 'Box',
    category: 'storage',
    stage: 'later',
    description: 'Enterprise document storage and metadata search.',
    rationale: 'Large-enterprise fit with similar search semantics to Drive and SharePoint.',
    primaryUseCases: ['Enterprise file search', 'Metadata lookup', 'Document access']
  },
  {
    id: 'datadog',
    name: 'Datadog',
    category: 'engineering',
    stage: 'later',
    description: 'Observability context and incident lookups.',
    rationale: 'Great for ops workflows, but needs careful scope design and rate management.',
    primaryUseCases: ['Incident context', 'Alert search', 'Operational debugging']
  }
] as const satisfies readonly PlatformSupportRecord[];

export const platformCatalog = [...currentSupportedPlatforms, ...nextPlatforms, ...laterPlatforms] as const;
