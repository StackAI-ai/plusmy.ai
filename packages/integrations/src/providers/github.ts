import { createScaffoldIntegration } from './scaffold';

export const githubIntegration = createScaffoldIntegration({
  id: 'github',
  displayName: 'GitHub',
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  defaultScopes: ['read:user', 'repo', 'read:org'],
  accountLabel: 'GitHub account',
  tools: [
    {
      name: 'github.search_repositories',
      title: 'Search GitHub repositories',
      description: 'Scaffolded repository search across connected organizations and repos.',
      requiredProviderScopes: ['repo'],
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          perPage: { type: 'number', default: 10 }
        },
        required: ['query']
      }
    },
    {
      name: 'github.read_issue',
      title: 'Read GitHub issue',
      description: 'Scaffolded issue read for repository issues and pull requests.',
      requiredProviderScopes: ['repo'],
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          issueNumber: { type: 'number' }
        },
        required: ['owner', 'repo', 'issueNumber']
      }
    },
    {
      name: 'github.comment_on_pull_request',
      title: 'Comment on pull request',
      description: 'Scaffolded governed pull-request comment workflow.',
      requiredProviderScopes: ['repo'],
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pullNumber: { type: 'number' },
          body: { type: 'string' }
        },
        required: ['owner', 'repo', 'pullNumber', 'body']
      }
    }
  ]
});
