import { createScaffoldIntegration } from './scaffold';

export const mondayIntegration = createScaffoldIntegration({
  id: 'monday',
  displayName: 'monday.com',
  authorizationUrl: 'https://auth.monday.com/oauth2/authorize',
  tokenUrl: 'https://auth.monday.com/oauth2/token',
  defaultScopes: ['me:read', 'boards:read', 'boards:write'],
  accountLabel: 'monday.com account',
  tools: [
    {
      name: 'monday.search_boards',
      title: 'Search monday.com boards',
      description: 'Scaffolded board search for operations teams.',
      requiredProviderScopes: ['boards:read'],
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 25 }
        },
        required: ['query']
      }
    },
    {
      name: 'monday.update_item',
      title: 'Update monday.com item',
      description: 'Scaffolded item update workflow for board-centric ops.',
      requiredProviderScopes: ['boards:write'],
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['itemId', 'body']
      }
    }
  ]
});

