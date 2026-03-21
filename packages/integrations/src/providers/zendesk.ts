import { createScaffoldIntegration } from './scaffold';

export const zendeskIntegration = createScaffoldIntegration({
  id: 'zendesk',
  displayName: 'Zendesk',
  authorizationUrl: 'https://example.zendesk.com/oauth/authorizations/new',
  tokenUrl: 'https://example.zendesk.com/oauth/tokens',
  defaultScopes: ['read', 'write'],
  accountLabel: 'Zendesk account',
  tools: [
    {
      name: 'zendesk.search_tickets',
      title: 'Search Zendesk tickets',
      description: 'Scaffolded ticket search across recent and open support work.',
      requiredProviderScopes: ['read'],
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
      name: 'zendesk.create_ticket_comment',
      title: 'Create Zendesk ticket comment',
      description: 'Scaffolded support follow-up comment workflow.',
      requiredProviderScopes: ['write'],
      inputSchema: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          body: { type: 'string' }
        },
        required: ['ticketId', 'body']
      }
    },
    {
      name: 'zendesk.update_ticket_status',
      title: 'Update Zendesk ticket status',
      description: 'Scaffolded status update workflow for support agents and operators.',
      requiredProviderScopes: ['write'],
      inputSchema: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          status: { type: 'string' }
        },
        required: ['ticketId', 'status']
      }
    }
  ]
});
