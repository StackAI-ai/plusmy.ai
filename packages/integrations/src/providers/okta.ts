import { createScaffoldIntegration } from './scaffold';

export const oktaIntegration = createScaffoldIntegration({
  id: 'okta',
  displayName: 'Okta',
  authorizationUrl: 'https://example.okta.com/oauth2/v1/authorize',
  tokenUrl: 'https://example.okta.com/oauth2/v1/token',
  defaultScopes: ['okta.users.read', 'okta.groups.read'],
  accountLabel: 'Okta tenant',
  tools: [
    {
      name: 'okta.lookup_user',
      title: 'Lookup Okta user',
      description: 'Scaffolded Okta user lookup by email or id.',
      requiredProviderScopes: ['okta.users.read'],
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    },
    {
      name: 'okta.list_groups',
      title: 'List Okta groups',
      description: 'Scaffolded Okta group listing for access posture workflows.',
      requiredProviderScopes: ['okta.groups.read'],
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 50 }
        }
      }
    }
  ]
});

