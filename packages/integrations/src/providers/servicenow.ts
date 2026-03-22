import { createScaffoldIntegration } from './scaffold';

export const serviceNowIntegration = createScaffoldIntegration({
  id: 'servicenow',
  displayName: 'ServiceNow',
  authorizationUrl: 'https://example.service-now.com/oauth_auth.do',
  tokenUrl: 'https://example.service-now.com/oauth_token.do',
  defaultScopes: ['sn_incidents.read', 'sn_requests.write', 'sn_changes.write'],
  accountLabel: 'ServiceNow tenant',
  tools: [
    {
      name: 'servicenow.search_incidents',
      title: 'Search incidents',
      description: 'Scaffolded incident lookup by user-defined query text.',
      requiredProviderScopes: ['sn_incidents.read'],
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
      name: 'servicenow.update_request',
      title: 'Update service request',
      description: 'Scaffolded service request state update workflow.',
      requiredProviderScopes: ['sn_requests.write'],
      inputSchema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          state: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['requestId', 'state']
      }
    }
  ]
});
