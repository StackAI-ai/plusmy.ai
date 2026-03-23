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
  authorizationUrl: '/oauth/authorizations/new',
  tokenUrl: '/oauth/tokens',
  defaultScopes: ['read', 'write']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.ZENDESK_CLIENT_ID || !env.ZENDESK_CLIENT_SECRET) {
    throw new Error('Zendesk OAuth credentials are missing.');
  }
  return { clientId: env.ZENDESK_CLIENT_ID, clientSecret: env.ZENDESK_CLIENT_SECRET };
}

function getInstanceUrl(providerConfig: Record<string, string> | undefined, metadata?: Record<string, Json> | null) {
  const raw = providerConfig?.instanceUrl ?? (metadata ? String(metadata.instanceUrl ?? '') : '');
  if (!raw) {
    throw new Error('Zendesk instance URL is required.');
  }
  return new URL(raw).origin.replace(/\/$/, '');
}

function parseScopes(value: unknown, fallback: string[]) {
  if (typeof value !== 'string' || value.length === 0) {
    return fallback;
  }
  return value
    .split(/[ ,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function exchangeAuthorizationCode(
  code: string,
  redirectUri: string,
  providerConfig?: Record<string, string>
) {
  const { clientId, clientSecret } = getCredentials();
  const instanceUrl = getInstanceUrl(providerConfig);
  const response = await fetch(`${instanceUrl}/oauth/tokens`, {
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
    throw new Error(String(data.error_description ?? data.error ?? 'Zendesk token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: { ...(data as Record<string, Json>), instanceUrl } as Json
  } satisfies ProviderTokenSet;
}

async function refreshTokens(refreshToken: string, metadata?: Record<string, Json> | null) {
  const { clientId, clientSecret } = getCredentials();
  const instanceUrl = getInstanceUrl(undefined, metadata);
  const response = await fetch(`${instanceUrl}/oauth/tokens`, {
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
    throw new Error(String(data.error_description ?? data.error ?? 'Zendesk token refresh failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: data as Json
  };
}

async function resolveAccount(tokenSet: ProviderTokenSet): Promise<ResolvedProviderAccount> {
  const raw = (tokenSet.raw as Record<string, unknown>) ?? {};
  const instanceUrl = getInstanceUrl(undefined, { instanceUrl: String(raw.instance_url ?? raw.instanceUrl ?? '') } as Record<string, Json> | null);
  if (!tokenSet.accessToken) throw new Error('Missing Zendesk access token.');

  const response = await fetch(`${instanceUrl}/api/v2/users/me.json`, {
    headers: {
      Authorization: `Bearer ${tokenSet.accessToken}`,
      Accept: 'application/json'
    }
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((data as Record<string, string>).error ?? 'Failed to resolve Zendesk account.'));
  }

  const user = (data as { user?: Record<string, unknown> }).user ?? {};
  const email = (user as Record<string, unknown>).email;

  return {
    externalAccountId: String((user as Record<string, unknown>).id ?? 'zendesk-user'),
    displayName: String((user as Record<string, unknown>).name ?? email ?? 'Zendesk user'),
    externalAccountEmail: email != null ? String(email) : null,
    metadata: {
      ...(raw as Record<string, unknown>),
      ...(data as Record<string, unknown>),
      instanceUrl
    }
  };
}

async function syncConnection({ credentials, connection }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Zendesk access token.');

  const account = await resolveAccount({
    ...(credentials as ProviderTokenSet),
    raw: { ...(connection.metadata as Record<string, Json>), instanceUrl: getInstanceUrl(undefined, connection.metadata as Record<string, Json> | null) }
  } satisfies ProviderTokenSet);

  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'zendesk.search_tickets',
    title: 'Search Zendesk tickets',
    description: 'Search Zendesk tickets by text or ticket id context.',
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
    description: 'Post a comment on a Zendesk ticket.',
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
    description: 'Update the status or resolution state of a Zendesk ticket.',
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
];

const liveScopes = ['read', 'write'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'zendesk',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'Zendesk access was revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Zendesk before ticket workflows run again.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'zendesk',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Zendesk requires reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Zendesk flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'zendesk',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Zendesk is missing required scopes for live tools.',
      signals: [
        `Missing scopes: ${missingScopes.join(', ')}`,
        'Reconnect Zendesk to restore ticket search and comment/write workflows.'
      ],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'zendesk',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Zendesk ticket workflows are healthy.',
    signals: ['OAuth grant active', 'Instance metadata present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

function parseZendeskError(data: unknown, defaultMessage: string) {
  const payload = (data ?? {}) as Record<string, unknown>;
  const errorField = payload.error;
  if (typeof errorField === 'string') return errorField;
  if (typeof errorField === 'object' && errorField !== null) {
    const message = (errorField as Record<string, unknown>).error?.toString() ?? (errorField as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  if (typeof payload.error_description === 'string') return payload.error_description;
  const errors = payload.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first != null && typeof (first as Record<string, unknown>).description === 'string')
      return String((first as Record<string, unknown>).description);
  }
  return defaultMessage;
}

export const zendeskIntegration: IntegrationDefinition = {
  id: 'zendesk',
  displayName: 'Zendesk',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes, providerConfig }) {
    if (!providerConfig?.instanceUrl) {
      throw new Error('Zendesk instance URL is required.');
    }
    const instanceUrl = new URL(providerConfig.instanceUrl).origin.replace(/\/$/, '');
    const url = new URL(`${instanceUrl}${oauth.authorizationUrl}`);
    const { clientId } = getCredentials();
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri, providerConfig }) {
    return exchangeAuthorizationCode(code, redirectUri, providerConfig);
  },
  async refreshTokens({ refreshToken, metadata }) {
    return refreshTokens(refreshToken, metadata as Record<string, Json> | null | undefined);
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveAccount(tokenSet);
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
  syncJobs: [{ jobType: 'sync_connection', run: syncConnection }],
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing Zendesk access token.');
    const instanceUrl = getInstanceUrl(undefined, context.connection.metadata as Record<string, Json> | null | undefined);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'content-type': 'application/json'
    };

    if (toolName === 'zendesk.search_tickets') {
      const query = String(input.query ?? '').trim();
      if (!query) throw new Error('query is required for ticket search.');
      const limit = Number(input.limit ?? 25);
      const response = await fetch(
        `${instanceUrl}/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=${Number.isFinite(limit) ? limit : 25}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseZendeskError(data, 'Zendesk ticket search failed.'));
      }
      return data;
    }

    if (toolName === 'zendesk.create_ticket_comment') {
      const ticketId = String(input.ticketId ?? '').trim();
      const body = String(input.body ?? '').trim();
      if (!ticketId) throw new Error('ticketId is required for Zendesk comments.');
      if (!body) throw new Error('body is required for Zendesk comments.');
      const response = await fetch(`${instanceUrl}/api/v2/tickets/${encodeURIComponent(ticketId)}.json`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          ticket: {
            comment: {
              body,
              public: false
            }
          }
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseZendeskError(data, 'Zendesk ticket comment failed.'));
      }
      return data;
    }

    if (toolName === 'zendesk.update_ticket_status') {
      const ticketId = String(input.ticketId ?? '').trim();
      const status = String(input.status ?? '').trim();
      if (!ticketId) throw new Error('ticketId is required for Zendesk ticket updates.');
      if (!status) throw new Error('status is required for Zendesk ticket updates.');
      const response = await fetch(`${instanceUrl}/api/v2/tickets/${encodeURIComponent(ticketId)}.json`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          ticket: {
            status
          }
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseZendeskError(data, 'Zendesk ticket status update failed.'));
      }
      return data;
    }

    throw new Error(`Unknown Zendesk tool: ${toolName}`);
  }
};
