import { createScaffoldIntegration } from './scaffold';

export const jiraIntegration = createScaffoldIntegration({
  id: 'jira',
  displayName: 'Jira',
  authorizationUrl: 'https://auth.atlassian.com/authorize',
  tokenUrl: 'https://auth.atlassian.com/oauth/token',
  defaultScopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
  accountLabel: 'Jira site',
  tools: [
    {
      name: 'jira.search_issues',
      title: 'Search Jira issues',
      description: 'Scaffolded Jira issue search across projects and boards.',
      requiredProviderScopes: ['read:jira-work'],
      inputSchema: {
        type: 'object',
        properties: {
          jql: { type: 'string' },
          maxResults: { type: 'number', default: 25 }
        },
        required: ['jql']
      }
    },
    {
      name: 'jira.transition_issue',
      title: 'Transition Jira issue',
      description: 'Scaffolded Jira issue status transition workflow.',
      requiredProviderScopes: ['write:jira-work'],
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: { type: 'string' },
          transitionId: { type: 'string' }
        },
        required: ['issueKey', 'transitionId']
      }
    },
    {
      name: 'jira.create_comment',
      title: 'Create Jira comment',
      description: 'Scaffolded Jira comment workflow for governed operator follow-up.',
      requiredProviderScopes: ['write:jira-work'],
      inputSchema: {
        type: 'object',
        properties: {
          issueKey: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['issueKey', 'body']
      }
    }
  ]
});
