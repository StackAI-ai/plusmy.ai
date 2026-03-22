import { createScaffoldIntegration } from './scaffold';

export const salesforceIntegration = createScaffoldIntegration({
  id: 'salesforce',
  displayName: 'Salesforce',
  authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
  tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
  defaultScopes: ['api', 'refresh_token', 'openid'],
  accountLabel: 'Salesforce instance',
  tools: [
    {
      name: 'salesforce.search_accounts',
      title: 'Search Salesforce accounts',
      description: 'Scaffolded account lookup for CRM and partner context.',
      requiredProviderScopes: ['api'],
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
      name: 'salesforce.update_case',
      title: 'Update Salesforce case',
      description: 'Scaffolded case status and note update workflow for support handoffs.',
      requiredProviderScopes: ['api'],
      inputSchema: {
        type: 'object',
        properties: {
          caseId: { type: 'string' },
          status: { type: 'string' },
          comment: { type: 'string' }
        },
        required: ['caseId', 'status']
      }
    }
  ]
});
