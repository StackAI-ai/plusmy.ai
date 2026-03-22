import { createScaffoldIntegration } from './scaffold';

export const hubspotIntegration = createScaffoldIntegration({
  id: 'hubspot',
  displayName: 'HubSpot',
  authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
  tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
  defaultScopes: ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.contacts.write'],
  accountLabel: 'HubSpot account',
  tools: [
    {
      name: 'hubspot.search_contacts',
      title: 'Search HubSpot contacts',
      description: 'Scaffolded customer-contact search for qualified account context.',
      requiredProviderScopes: ['crm.objects.contacts.read'],
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          properties: { type: 'string' },
          limit: { type: 'number', default: 25 }
        },
        required: ['query']
      }
    },
    {
      name: 'hubspot.update_contact',
      title: 'Update HubSpot contact',
      description: 'Scaffolded contact note and lifecycle update workflow.',
      requiredProviderScopes: ['crm.objects.contacts.write'],
      inputSchema: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['contactId', 'note']
      }
    }
  ]
});
