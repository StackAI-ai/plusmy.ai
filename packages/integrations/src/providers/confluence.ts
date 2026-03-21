import { createScaffoldIntegration } from './scaffold';

export const confluenceIntegration = createScaffoldIntegration({
  id: 'confluence',
  displayName: 'Confluence',
  authorizationUrl: 'https://auth.atlassian.com/authorize',
  tokenUrl: 'https://auth.atlassian.com/oauth/token',
  defaultScopes: ['read:confluence-content.summary', 'read:confluence-content.all', 'offline_access'],
  accountLabel: 'Confluence site',
  tools: [
    {
      name: 'confluence.search_spaces',
      title: 'Search Confluence spaces',
      description: 'Scaffolded Confluence knowledge search across spaces and pages.',
      requiredProviderScopes: ['read:confluence-content.summary'],
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
      name: 'confluence.read_page',
      title: 'Read Confluence page',
      description: 'Scaffolded Confluence page read workflow for documentation access.',
      requiredProviderScopes: ['read:confluence-content.all'],
      inputSchema: {
        type: 'object',
        properties: {
          pageId: { type: 'string' }
        },
        required: ['pageId']
      }
    }
  ]
});
