import { createScaffoldIntegration } from './scaffold';

export const linearIntegration = createScaffoldIntegration({
  id: 'linear',
  displayName: 'Linear',
  authorizationUrl: 'https://linear.app/oauth/authorize',
  tokenUrl: 'https://api.linear.app/oauth/token',
  defaultScopes: ['read', 'write', 'issues:create'],
  accountLabel: 'Linear workspace',
  tools: [
    {
      name: 'linear.search_issues',
      title: 'Search Linear issues',
      description: 'Scaffolded Linear issue search for backlog and execution review workflows.',
      requiredProviderScopes: ['read'],
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
      name: 'linear.update_issue',
      title: 'Update Linear issue',
      description: 'Scaffolded issue state and field update workflow.',
      requiredProviderScopes: ['write'],
      inputSchema: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          stateId: { type: 'string' },
          assigneeId: { type: 'string' }
        },
        required: ['issueId']
      }
    },
    {
      name: 'linear.create_comment',
      title: 'Create Linear comment',
      description: 'Scaffolded execution-note comment workflow for issues.',
      requiredProviderScopes: ['write'],
      inputSchema: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['issueId', 'body']
      }
    }
  ]
});
