import { getServerEnv } from '@plusmy/config';
import type {
  ConnectionRecord,
  Json,
  McpResourceDefinition,
  McpToolDefinition,
  ProviderHealthSnapshot,
  ProviderTokenSet
} from '@plusmy/contracts';
import type {
  AuthorizationCodeInput,
  AuthorizationUrlInput,
  IntegrationDefinition,
  ProviderCallContext,
  ResolvedProviderAccount,
  SyncJobHandlerInput
} from '../types';
import { getMissingScopes } from '../scope-drift';

const oauth = {
  authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
  tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
  defaultScopes: ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.contacts.write']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.HUBSPOT_CLIENT_ID || !env.HUBSPOT_CLIENT_SECRET) {
    throw new Error('HubSpot OAuth credentials are missing.');
  }
  return { clientId: env.HUBSPOT_CLIENT_ID, clientSecret: env.HUBSPOT_CLIENT_SECRET };
}

function parseScopes(value: unknown, fallback: string[]): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }

  return value
    .split(/[ ,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function exchange(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'HubSpot token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 21600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

async function resolveAccountFromToken(accessToken: string): Promise<ResolvedProviderAccount> {
  const response = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`);
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((data as Record<string, string>).message ?? 'HubSpot account resolve failed.'));
  }

  return {
    externalAccountId: String(
      data.user_id ??
      data.hub_id ??
      data.access_token_id ??
      data.app_id ??
      'hubspot-account'
    ),
    displayName: String(data.user ?? data.hub_domain ?? 'HubSpot account'),
    externalAccountEmail: null,
    metadata: data
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing HubSpot access token.');

  const account = await resolveAccountFromToken(accessToken);
  const response = await fetch('https://api.hubapi.com/crm/v3/owners/', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const ownersData = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((ownersData as Record<string, string>).message ?? 'HubSpot sync failed.'));
  }

  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: null,
    metadata: { ...((account.metadata as Record<string, Json>) ?? {}), owners: ownersData as Json }
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'hubspot.search_contacts',
    title: 'Search HubSpot contacts',
    description: 'Search CRM contacts to find support and sales context for customer-facing workflows.',
    requiredProviderScopes: ['crm.objects.contacts.read'],
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
    name: 'hubspot.update_contact',
    title: 'Update HubSpot contact',
    description: 'Patch selected contact properties to record updates in CRM.',
    requiredProviderScopes: ['crm.objects.contacts.write'],
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        properties: { type: 'object', additionalProperties: { type: 'string' } }
      },
      required: ['contactId', 'properties']
    }
  }
];

const liveScopes = ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.contacts.write'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'hubspot',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This HubSpot connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect HubSpot before tool calls resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'hubspot',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'HubSpot needs reauthorization before CRM tools can run.',
      signals: [connection.reauth_required_reason ?? 'HubSpot flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'hubspot',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'HubSpot is missing one or more scopes required by the live CRM tool set.',
      signals: [
        `Missing scopes: ${missingScopes.join(', ')}`,
        'Reconnect HubSpot and request updated consent to restore search/contact workflows.'
      ],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'hubspot',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'HubSpot contact search and update access is healthy.',
    signals: ['OAuth grant active', 'CRM scopes present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const hubspotIntegration: IntegrationDefinition = {
  id: 'hubspot',
  displayName: 'HubSpot',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    return exchange(code, redirectUri);
  },
  async refreshTokens({ refreshToken }) {
    const { clientId, clientSecret } = getCredentials();
    const response = await fetch(oauth.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(data.error_description ?? data.error ?? 'HubSpot token refresh failed.'));
    }

    const expiresIn = Number(data.expires_in ?? 21600);
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
      tokenType: String(data.token_type ?? 'Bearer'),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: parseScopes(data.scope, oauth.defaultScopes),
      raw: data as Json
    };
  },
  async resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveAccountFromToken(String(tokenSet.accessToken ?? ''));
  },
  listTools(_connection: ConnectionRecord) {
    return tools;
  },
  listResources(_connection: ConnectionRecord): McpResourceDefinition[] {
    return [];
  },
  health(connection: ConnectionRecord) {
    return buildHealthSnapshot(connection);
  },
  syncJobs: [
    {
      jobType: 'sync_connection',
      run: syncConnection
    }
  ],
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing HubSpot access token.');

    if (toolName === 'hubspot.search_contacts') {
      const query = String(input.query ?? '');
      const limit = Number(input.limit ?? 10);
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          query,
          limit,
          properties: ['email', 'firstname', 'lastname', 'phone', 'company']
        })
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(String((data as Record<string, string>).message ?? 'HubSpot contact search failed.'));
      }
      return data;
    }

    if (toolName === 'hubspot.update_contact') {
      const contactId = String(input.contactId ?? '').trim();
      if (!contactId) {
        throw new Error('Missing contactId.');
      }
      const properties =
        (input.properties as Record<string, unknown>) ?? ({} as Record<string, unknown>);
      const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ properties })
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(String((data as Record<string, string>).message ?? 'HubSpot contact update failed.'));
      }
      return data;
    }

    throw new Error(`Unsupported HubSpot tool: ${toolName}`);
  }
};
