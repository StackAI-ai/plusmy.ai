import { createScaffoldIntegration } from './scaffold';

export const microsoft365Integration = createScaffoldIntegration({
  id: 'microsoft365',
  displayName: 'Microsoft 365',
  authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  defaultScopes: ['offline_access', 'Files.Read.All', 'Sites.Read.All', 'User.Read'],
  accountLabel: 'Microsoft 365 tenant',
  tools: [
    {
      name: 'microsoft365.search_onedrive',
      title: 'Search OneDrive',
      description: 'Scaffolded OneDrive file search across connected user and shared storage.',
      requiredProviderScopes: ['Files.Read.All'],
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 }
        },
        required: ['query']
      }
    },
    {
      name: 'microsoft365.read_sharepoint_document',
      title: 'Read SharePoint document',
      description: 'Scaffolded SharePoint document read workflow for enterprise knowledge access.',
      requiredProviderScopes: ['Sites.Read.All'],
      inputSchema: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          itemId: { type: 'string' }
        },
        required: ['siteId', 'itemId']
      }
    }
  ]
});
