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
  | 'productivity'
  | 'identity';

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
  providerId?:
    | 'google'
    | 'slack'
    | 'notion'
    | 'dropbox'
    | 'box'
    | 'confluence'
    | 'zendesk'
    | 'hubspot'
    | 'salesforce'
    | 'servicenow'
    | 'okta'
    | 'asana'
    | 'monday'
    | 'microsoft365'
    | 'github'
    | 'linear'
    | 'jira'
    | 'quickbooks'
    | 'xero';
  capabilities: PlatformCapability[];
}

type LiveProviderMetadata = PlatformCatalogEntry & {
  providerId:
    | 'google'
    | 'slack'
    | 'notion'
    | 'dropbox'
    | 'box'
    | 'confluence'
    | 'zendesk'
    | 'hubspot'
    | 'salesforce'
    | 'servicenow'
    | 'okta'
    | 'asana'
    | 'monday'
    | 'microsoft365'
    | 'github'
    | 'linear'
    | 'jira';
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
    summary: 'Search and read Drive/Docs content for your team.',
    connectLabel: 'Google',
    capabilities: [
      { label: 'Drive search', detail: 'Search shared and personal Drive files.' },
      { label: 'Docs read', detail: 'Open Google Docs content with workspace permissions.' }
    ]
  },
  {
    id: 'slack',
    providerId: 'slack',
    name: 'Slack',
    status: 'live',
    surface: 'provider',
    category: 'chat',
    summary: 'Channel discovery, history access, and posting for team collaboration workflows.',
    connectLabel: 'Slack',
    capabilities: [
      { label: 'Channel list', detail: 'Enumerate public workspace channels.' },
      { label: 'History read', detail: 'Review channel context before taking action.' },
      { label: 'Post message', detail: 'Send messages back into Slack from approved workflows.' }
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
      { label: 'Workspace search', detail: 'Search pages and databases.' },
      { label: 'Page read', detail: 'Fetch structured page content.' },
      { label: 'Page create', detail: 'Create follow-up documents from approved client workflows.' }
    ]
  },
  {
    id: 'dropbox',
    providerId: 'dropbox',
    name: 'Dropbox',
    status: 'live',
    surface: 'provider',
    category: 'storage',
    summary: 'Workspace and personal Dropbox installs with file search and file reads.',
    connectLabel: 'Dropbox',
    capabilities: [
      { label: 'File search', detail: 'Search shared Dropbox content and metadata.' },
      { label: 'File read', detail: 'Read Dropbox file content with workspace permissions.' }
    ]
  },
  {
    id: 'box',
    providerId: 'box',
    name: 'Box',
    status: 'live',
    surface: 'provider',
    category: 'storage',
    summary: 'Enterprise Box installs with file search and file reads for content-heavy teams.',
    connectLabel: 'Box',
    capabilities: [
      { label: 'File search', detail: 'Search Box files and folders from approved workflows.' },
      { label: 'File read', detail: 'Read Box file content and metadata.' }
    ]
  },
  {
    id: 'hubspot',
    providerId: 'hubspot',
    name: 'HubSpot',
    status: 'live',
    surface: 'provider',
    category: 'crm',
    summary: 'CRM contact and company workflows for customer-facing operators.',
    connectLabel: 'HubSpot',
    capabilities: [
      { label: 'Contact search', detail: 'Search contacts and companies by workspace context.' },
      { label: 'Contact updates', detail: 'Write controlled lifecycle notes and updates.' }
    ]
  },
  {
    id: 'salesforce',
    providerId: 'salesforce',
    name: 'Salesforce',
    status: 'live',
    surface: 'provider',
    category: 'crm',
    summary: 'Enterprise CRM workflows for accounts, opportunities, and support handoffs.',
    connectLabel: 'Salesforce',
    capabilities: [
      { label: 'Account lookup', detail: 'Resolve accounts and related objects by context.' },
      { label: 'Case comments', detail: 'Post controlled updates back into support cases.' }
    ]
  },
  {
    id: 'servicenow',
    providerId: 'servicenow',
    name: 'ServiceNow',
    status: 'live',
    surface: 'provider',
    category: 'support',
    summary: 'Incident and request workflows for IT and enterprise operations teams.',
    connectLabel: 'ServiceNow',
    capabilities: [
      { label: 'Incident search', detail: 'Find incidents and service records quickly.' },
      { label: 'Incident comments', detail: 'Add controlled follow-ups and status context.' }
    ]
  },
  {
    id: 'okta',
    providerId: 'okta',
    name: 'Okta',
    status: 'live',
    surface: 'provider',
    category: 'identity',
    summary: 'User and group lookup workflows for admin and access-management use cases.',
    connectLabel: 'Okta',
    capabilities: [
      { label: 'User lookup', detail: 'Resolve user identity records and lifecycle state.' },
      { label: 'Group inspection', detail: 'Inspect group membership and access posture.' }
    ]
  },
  {
    id: 'asana',
    providerId: 'asana',
    name: 'Asana',
    status: 'live',
    surface: 'provider',
    category: 'project_management',
    summary: 'Task and comment workflows for planning-heavy operating teams.',
    connectLabel: 'Asana',
    capabilities: [
      { label: 'Task search', detail: 'Find tasks by query and workspace context.' },
      { label: 'Task comments', detail: 'Post controlled status updates back into Asana.' }
    ]
  },
  {
    id: 'monday',
    providerId: 'monday',
    name: 'monday.com',
    status: 'live',
    surface: 'provider',
    category: 'project_management',
    summary: 'Board-centric operations workflows for teams running on monday.com.',
    connectLabel: 'monday.com',
    capabilities: [
      { label: 'Board search', detail: 'Locate boards and items quickly.' },
      { label: 'Item updates', detail: 'Write controlled updates into monday.com items.' }
    ]
  },
  {
    id: 'microsoft-365',
    providerId: 'microsoft365',
    name: 'Microsoft 365',
    status: 'live',
    surface: 'provider',
    category: 'documents',
    summary: 'OneDrive and SharePoint file search/read workflows for Microsoft-first orgs.',
    connectLabel: 'Microsoft 365',
    capabilities: [
      { label: 'OneDrive search', detail: 'Search files and folders by workspace context.' },
      { label: 'SharePoint read', detail: 'Read tenant knowledge stored in sites and document libraries.' }
    ]
  },
  {
    id: 'github',
    providerId: 'github',
    name: 'GitHub',
    status: 'live',
    surface: 'provider',
    category: 'engineering',
    summary: 'Repository, issue, and pull-request workflows for engineering operators.',
    connectLabel: 'GitHub',
    capabilities: [
      { label: 'Repo search', detail: 'Search repositories and issues across orgs.' },
      { label: 'Pull request comments', detail: 'Leave comments and follow-ups on pull requests.' }
    ]
  },
  {
    id: 'linear',
    providerId: 'linear',
    name: 'Linear',
    status: 'live',
    surface: 'provider',
    category: 'project_management',
    summary: 'Issue search and update workflows for operator follow-up loops.',
    connectLabel: 'Linear',
    capabilities: [
      { label: 'Issue search', detail: 'Find backlog and in-flight issues quickly.' },
      { label: 'Comments + updates', detail: 'Post execution notes and status updates.' }
    ]
  },
  {
    id: 'jira',
    providerId: 'jira',
    name: 'Jira',
    status: 'live',
    surface: 'provider',
    category: 'project_management',
    summary: 'Enterprise ticket search and update flows for cross-team delivery environments.',
    connectLabel: 'Jira',
    capabilities: [
      { label: 'Issue search', detail: 'Find incidents and project tickets by workspace context.' },
      { label: 'Status updates', detail: 'Advance or comment on tasks from approved workflows.' }
    ]
  },
  {
    id: 'confluence',
    providerId: 'confluence',
    name: 'Confluence',
    status: 'live',
    surface: 'provider',
    category: 'knowledge',
    summary: 'Knowledge-base search and read support for documentation-heavy engineering orgs.',
    connectLabel: 'Confluence',
    capabilities: [
      { label: 'Space search', detail: 'Search enterprise spaces and documentation for context grounding.' },
      { label: 'Page read', detail: 'Read Confluence pages inside approved workflows.' }
    ]
  },
  {
    id: 'zendesk',
    providerId: 'zendesk',
    name: 'Zendesk',
    status: 'live',
    surface: 'provider',
    category: 'support',
    summary: 'Ticket search and reply support for customer operations teams.',
    connectLabel: 'Zendesk',
    capabilities: [
      { label: 'Ticket search', detail: 'Locate open customer tickets by workspace context.' },
      { label: 'Reply drafting', detail: 'Post controlled follow-up messages and status changes.' }
    ]
  }
] as const satisfies readonly LiveProviderMetadata[];

export const plannedProviderPlatforms = [
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
  },
  {
    id: 'zoom',
    name: 'Zoom',
    status: 'planned',
    surface: 'provider',
    category: 'productivity',
    summary: 'Meeting context, transcript, and follow-up workflows for distributed teams.',
    rationale: 'Adds conversational context around decisions, notes, and action items that never make it into docs.',
    capabilities: [
      { label: 'Meeting search', detail: 'Find meetings and participants tied to workspace context.' },
      { label: 'Transcript read', detail: 'Pull transcripts and summaries into workflow context.' }
    ]
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    status: 'planned',
    surface: 'provider',
    category: 'productivity',
    summary: 'Accounts-receivable and customer finance workflows for finance operators.',
    rationale: 'Brings finance context into the same approval and workspace-scoped tool model used by CRM and support tools.',
    capabilities: [
      { label: 'Customer search', detail: 'Find customers and invoices tied to workspace context.' },
      { label: 'Invoice lookup', detail: 'Retrieve invoice state and detail for operators and handoffs.' }
    ]
  },
  {
    id: 'xero',
    name: 'Xero',
    status: 'planned',
    surface: 'provider',
    category: 'productivity',
    summary: 'Core bookkeeping operations for payment and billing workflows.',
    rationale: 'Complements QuickBooks and CRM coverage for operators handling finance approvals and follow-ups.',
    capabilities: [
      { label: 'Contact search', detail: 'Find finance contacts and account summaries by query.' },
      { label: 'Invoice read', detail: 'Pull billed/unbilled and draft invoice snapshots into context workflows.' }
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
    summary: 'Connect OpenAI-based assistants to your workspace tools with secure sign-in and approvals.',
    rationale: 'Strong standards fit and a core target for the product surface.',
    capabilities: [
      { label: 'Secure sign-in', detail: 'Authorize with PKCE and workspace consent.' },
      { label: 'Tool access', detail: 'Use connected provider tools and workspace context.' }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    status: 'beta',
    surface: 'mcp_client',
    category: 'productivity',
    summary: 'Connect Anthropic-based assistants to your workspace tools with secure sign-in and approvals.',
    rationale: 'Important ecosystem target and aligned with the standards-based transport surface.',
    capabilities: [
      { label: 'Secure sign-in', detail: 'Use standards-based OAuth discovery and sign-in.' },
      { label: 'Workspace consent', detail: 'Operators approve access with workspace scoping.' }
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini',
    status: 'beta',
    surface: 'mcp_client',
    category: 'productivity',
    summary: 'Connect Gemini assistants and adjacent tools to your workspace tools with secure sign-in.',
    rationale: 'Keeps the product positioned as a neutral operator layer instead of a single-model utility.',
    capabilities: [
      { label: 'Client setup', detail: 'Register a compatible client and complete OAuth sign-in.' },
      { label: 'Workspace access', detail: 'Use provider-backed tools through the workspace integration endpoint.' }
    ]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    status: 'beta',
    surface: 'mcp_client',
    category: 'engineering',
    summary: 'Use Cursor with your workspace tools and context for faster delivery workflows.',
    rationale: 'Practical day-one coding-agent target and already reflected in the product copy.',
    capabilities: [
      { label: 'Coding workflows', detail: 'Use connected tools inside code-assistant workflows.' },
      { label: 'Workspace permissions', detail: 'Keep approvals and tool visibility workspace-aware.' }
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

export function getPlatformCategoryCounts() {
  return platformCatalog.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    return counts;
  }, {});
}

export function getProviderMetadata(providerId: (typeof supportedProviders)[number]['providerId']) {
  return supportedProviders.find((provider) => provider.providerId === providerId) ?? null;
}
