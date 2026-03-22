import { createScaffoldIntegration } from './scaffold';

export const asanaIntegration = createScaffoldIntegration({
  id: 'asana',
  displayName: 'Asana',
  authorizationUrl: 'https://app.asana.com/-/oauth_authorize',
  tokenUrl: 'https://app.asana.com/-/oauth_token',
  defaultScopes: ['default'],
  accountLabel: 'Asana workspace',
  tools: [
    {
      name: 'asana.search_tasks',
      title: 'Search Asana tasks',
      description: 'Scaffolded Asana task search for project-management workflows.',
      requiredProviderScopes: ['default'],
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
      name: 'asana.comment_on_task',
      title: 'Comment on Asana task',
      description: 'Scaffolded Asana comment workflow for governed follow-ups.',
      requiredProviderScopes: ['default'],
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['taskId', 'body']
      }
    }
  ]
});

