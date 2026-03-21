export type PlatformStatus = 'live' | 'planned' | 'beta';
export type PlatformSurface = 'provider' | 'mcp_client';
export type PlatformCategory =
  | 'documents'
  | 'chat'
  | 'knowledge'
  | 'engineering'
  | 'project_management'
  | 'crm'
  | 'support'
  | 'storage'
  | 'productivity';

export interface PlatformCapability {
  label: string;
  detail: string;
}

export interface PlatformCatalogEntry {
  id: string;
  name: string;
  status: PlatformStatus;
  surface: PlatformSurface;
  category: PlatformCategory;
  summary: string;
  rationale?: string;
  providerId?: 'google' | 'slack' | 'notion';
  capabilities: PlatformCapability[];
}

type LiveProviderMetadata = PlatformCatalogEntry & {
  providerId: 'google' | 'slack' | 'notion';
  connectLabel: string;
};

export const supportedProviders = [
  {
    id: 'google-workspace',
    providerId: 'google',
    name: 'Google Workspace',
    status: 'live',
    surface: 'provider',
    category: 'documents',
    summary: 'Drive and Docs search/read access for workspace or personal installs.',
    connectLabel: 'Google',
    capabilities: [
      { label: 'Drive search', detail: 'Search shared and personal Drive files through MCP.' },
      { label: 'Docs read', detail: 'Open Google Docs content with workspace-scoped auth.' }
    ]
  },
  {
    id: 'slack',
    providerId: 'slack',
    name: 'Slack',
    status: 'live',
    surface: 'provider',
    category: 'chat',
    summary: 'Channel discovery, history access, and post-message support for operator workflows.',
    connectLabel: 'Slack',
    capabilities: [
      { label: 'Channel list', detail: 'Enumerate public workspace channels.' },
      { label: 'History read', detail: 'Review channel context before an agent acts.' },
      { label: 'Post message', detail: 'Send messages back into Slack from approved MCP clients.' }
    ]
  },
  {
    id: 'notion',
    providerId: 'notion',
    name: 'Notion',
    status: 'live',
    surface: 'provider',
    category: 'knowledge',
    summary: 'Search, read, and create-page workflows for team knowledge bases.',
    connectLabel: 'Notion',
    capabilities: [
      { label: 'Workspace search', detail: 'Search pages and databases from MCP tools.' },
      { label: 'Page read', detail: 'Fetch structured page content through the provider adapter.' },
      { label: 'Page create', detail: 'Create follow-up documents from approved client workflows.' }
    ]
  }
] as const satisfies readonly LiveProviderMetadata[];

export const plannedProviderPlatforms = [
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    status: 'planned',
    surface: 'provider',
    category: 'documents',
    summary: 'OneDrive, SharePoint, Word, and Excel parity for enterprises that are not on Google.',
    rationale: 'Closes the largest document-platform gap and fits the current OAuth + workspace model cleanly.',
    capabilities: [
      { label: 'OneDrive search', detail: 'Search files and folders by workspace context.' },
      { label: 'SharePoint read', detail: 'Read tenant knowledge stored in sites and document libraries.' }
    ]
  },
  {
    id: 'github',
    name: 'GitHub',
    status: 'planned',
    surface: 'provider',
    category: 'engineering',
    summary: 'Repository, issue, and pull-request workflows for engineering operators and coding agents.',
    rationale: 'Natural MCP workload and a strong complement to Slack plus Notion for software teams.',
    capabilities: [
      { label: 'Repo search', detail: 'Search code and issues across connected repositories.' },
      { label: 'PR actions', detail: 'Read pull requests and leave governed comments.' }
    ]
  },
  {
    id: 'linear',
    name: 'Linear',
    status: 'planned',
    surface: 'provider',
    category: 'project_management',
    summary: 'Issue search, updates, and comments for internal dogfooding and operator follow-up loops.',
    rationale: 'Matches the current workflow style and is a high-signal system of record for product work.',
    capabilities: [
      { label: 'Issue search', detail: 'Find backlog and in-flight issues quickly.' },
      { label: 'Comment + update', detail: 'Post execution notes and close finished tasks.' }
    ]
  },
  {
    id: 'jira',
    name: 'Jira',
    status: 'planned',
    surface: 'provider',
    category: 'project_management',
    summary: 'Enterprise ticket search and update flows for cross-team delivery environments.',
    rationale: 'Important for larger customer environments where Jira remains the operational source of truth.',
    capabilities: [
      { label: 'Issue search', detail: 'Find incidents and project tickets by workspace context.' },
      { label: 'Status updates', detail: 'Advance or comment on tasks from MCP workflows.' }
    ]
  },
  {
    id: 'confluence',
    name: 'Confluence',
    status: 'planned',
    surface: 'provider',
    category: 'knowledge',
    summary: 'Knowledge-base search and read support alongside Jira-driven delivery workflows.',
    rationale: 'Pairs naturally with Jira and broadens enterprise documentation coverage beyond Notion.',
    capabilities: [
      { label: 'Space search', detail: 'Search enterprise docs and runbooks.' },
      { label: 'Page read', detail: 'Open documentation during tool execution and audit review.' }
    ]
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    status: 'planned',
    surface: 'provider',
    category: 'crm',
    summary: 'CRM access for sales, lifecycle, and customer-facing operator workflows.',
    rationale: 'Adds a high-value customer-data surface while staying compatible with workspace-scoped approval rules.',
    capabilities: [
      { label: 'Contact search', detail: 'Search contacts and companies by workspace context.' },
      { label: 'Deal updates', detail: 'Write notes or stage changes with governed access.' }
    ]
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    status: 'planned',
    surface: 'provider',
    category: 'crm',
    summary: 'Enterprise CRM coverage for accounts, opportunities, and support handoff workflows.',
    rationale: 'Critical for enterprise buyers and well suited to strict approval and audit boundaries.',
    capabilities: [
      { label: 'Account lookup', detail: 'Read account and opportunity context on demand.' },
      { label: 'Case updates', detail: 'Support guided handoffs between AI clients and operators.' }
    ]
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    status: 'planned',
    surface: 'provider',
    category: 'support',
    summary: 'Ticket search and reply support for customer operations teams.',
    rationale: 'Adds a clear support-data system that pairs well with Slack and CRM integrations.',
    capabilities: [
      { label: 'Ticket search', detail: 'Find open and recent support cases.' },
      { label: 'Reply drafting', detail: 'Post governed follow-up messages back to agents.' }
    ]
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    status: 'planned',
    surface: 'provider',
    category: 'storage',
    summary: 'File search/read coverage for organizations that do not standardize on Drive or SharePoint.',
    rationale: 'Extends the same document-access pattern already proven with Google Drive.',
    capabilities: [
      { label: 'File search', detail: 'Search files and metadata quickly.' },
      { label: 'File read', detail: 'Open shared content for MCP workflows.' }
    ]
  },
  {
    id: 'airtable',
    name: 'Airtable',
    status: 'planned',
    surface: 'provider',
    category: 'productivity',
    summary: 'Operational-table read/write support for teams using Airtable as a lightweight app layer.',
    rationale: 'Strong fit for agent-assisted operational updates with explicit audit requirements.',
    capabilities: [
      { label: 'Base search', detail: 'Find records across connected bases.' },
      { label: 'Record updates', detail: 'Write controlled updates into operational tables.' }
    ]
  }
] as const satisfies readonly PlatformCatalogEntry[];

export const supportedMcpClients = [
  {
    id: 'openai',
    name: 'OpenAI',
    status: 'beta',
    surface: 'mcp_client',
    category: 'productivity',
    summary: 'OAuth-native MCP metadata and bearer-token flow are designed to work with OpenAI-compatible MCP clients.',
    rationale: 'Strong standards fit and a core target for the product surface.',
    capabilities: [
      { label: 'OAuth 2.1', detail: 'Authorize against plusmy.ai with PKCE and workspace consent.' },
      { label: 'MCP tools + resources', detail: 'Consume provider tools and bound workspace context.' }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    status: 'beta',
    surface: 'mcp_client',
    category: 'productivity',
    summary: 'Positioned for modern MCP clients built around Anthropic-compatible workflows.',
    rationale: 'Important ecosystem target and aligned with the standards-based transport surface.',
    capabilities: [
      { label: 'OAuth discovery', detail: 'Use protected-resource and auth-server metadata.' },
      { label: 'Workspace consent', detail: 'Operators can approve access with workspace scoping.' }
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini',
    status: 'beta',
    surface: 'mcp_client',
    category: 'productivity',
    summary: 'Standards-based MCP access for Gemini-adjacent tools and experiments.',
    rationale: 'Keeps the product positioned as a neutral operator layer instead of a single-model utility.',
    capabilities: [
      { label: 'Client registration', detail: 'Register a compatible client and complete PKCE auth.' },
      { label: 'Resource access', detail: 'Read provider-backed resources through the MCP endpoint.' }
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    status: 'beta',
    surface: 'mcp_client',
    category: 'engineering',
    summary: 'Developer-facing MCP workflows that combine platform tools with workspace context.',
    rationale: 'Practical day-one coding-agent target and already reflected in the product copy.',
    capabilities: [
      { label: 'Coding workflows', detail: 'Use provider tools inside code-assistant workflows.' },
      { label: 'Workspace-scoped auth', detail: 'Keep approvals and tool visibility tenant-aware.' }
    ]
  }
] as const satisfies readonly PlatformCatalogEntry[];

function assertPlatformCatalog(entries: readonly PlatformCatalogEntry[]) {
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.id.trim()) {
      throw new Error('Platform catalog entries must have a non-empty id.');
    }

    if (seen.has(entry.id)) {
      throw new Error(`Duplicate platform catalog id: ${entry.id}`);
    }

    if (entry.capabilities.length === 0) {
      throw new Error(`Platform catalog entry ${entry.id} must define at least one capability.`);
    }

    if (entry.capabilities.some((capability) => capability.label.trim().length === 0 || capability.detail.trim().length === 0)) {
      throw new Error(`Platform catalog entry ${entry.id} has an invalid capability label or detail.`);
    }

    seen.add(entry.id);
  }
}

export const platformCatalog = [...supportedProviders, ...plannedProviderPlatforms, ...supportedMcpClients] as const;

assertPlatformCatalog(platformCatalog);

export function getPlatformCounts() {
  return {
    liveProviders: supportedProviders.length,
    plannedPlatforms: plannedProviderPlatforms.length,
    supportedClients: supportedMcpClients.length
  };
}

export function getProviderMetadata(providerId: 'google' | 'slack' | 'notion') {
  return supportedProviders.find((provider) => provider.providerId === providerId) ?? null;
}
