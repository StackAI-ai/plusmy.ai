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
  authorizationUrl: '/oauth_auth.do',
  tokenUrl: '/oauth_token.do',
  defaultScopes: ['useraccount', 'sn_incidents.read', 'sn_requests.write']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.SERVICENOW_CLIENT_ID || !env.SERVICENOW_CLIENT_SECRET) {
    throw new Error('ServiceNow OAuth credentials are missing.');
  }
  return { clientId: env.SERVICENOW_CLIENT_ID, clientSecret: env.SERVICENOW_CLIENT_SECRET };
}

function getInstanceUrl(providerConfig: Record<string, string> | undefined, metadata: Record<string, Json> | null | undefined) {
  const raw = providerConfig?.instanceUrl ?? String((metadata as Record<string, Json> | null)?.instanceUrl ?? '');
  if (!raw) {
    throw new Error('ServiceNow instance URL is required.');
  }
  const parsed = new URL(raw);
  return parsed.origin.replace(/\/$/, '');
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
  const instanceUrl = getInstanceUrl(providerConfig, null);
  const response = await fetch(`${instanceUrl}/oauth_token.do`, {
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
    throw new Error(String(data.error_description ?? data.error ?? 'ServiceNow token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: { ...(data as Record<string, Json>), instance_url: instanceUrl } as Json
  } satisfies ProviderTokenSet;
}

async function refreshTokens(refreshToken: string, metadata?: Record<string, Json> | null) {
  const { clientId, clientSecret } = getCredentials();
  const instanceUrl = getInstanceUrl(undefined, metadata);
  const response = await fetch(`${instanceUrl}/oauth_token.do`, {
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
    throw new Error(String(data.error_description ?? data.error ?? 'ServiceNow token refresh failed.'));
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
  const instanceUrl = getInstanceUrl(undefined, { instanceUrl: String(raw.instance_url ?? '') } as Record<string, Json> | null | undefined);
  const token = tokenSet.accessToken ?? '';
  if (!token) throw new Error('Missing ServiceNow access token.');

  const response = await fetch(`${instanceUrl}/api/now/whoami`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((data as Record<string, string>).error ?? 'Failed to resolve ServiceNow account.'));
  }

  return {
    externalAccountId: String((data as Record<string, unknown>).userId ?? 'servicenow-user'),
    displayName: String((data as Record<string, unknown>).userName ?? 'ServiceNow tenant'),
    externalAccountEmail: null,
    metadata: { ...data, instanceUrl }
  };
}

async function syncConnection({ credentials, connection }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing ServiceNow access token.');

  const tokenSet = credentials as ProviderTokenSet;
  const account = await resolveAccount({
    ...tokenSet,
    accessToken,
    raw: { ...(connection.metadata as Record<string, Json>), instance_url: getInstanceUrl(undefined, connection.metadata as Record<string, Json> | null | undefined) }
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
    name: 'servicenow.search_incidents',
    title: 'Search incidents',
    description: 'Search incidents by short description and metadata keywords.',
    requiredProviderScopes: ['useraccount'],
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
    title: 'Update service request (legacy alias)',
    description: 'Legacy alias for service request updates; prefer servicenow.add_incident_comment.',
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
  },
  {
    name: 'servicenow.add_incident_comment',
    title: 'Add incident comment',
    description: 'Add a comment to an incident with optional state update.',
    requiredProviderScopes: ['sn_requests.write'],
    inputSchema: {
      type: 'object',
      properties: {
        incidentId: { type: 'string' },
        note: { type: 'string' },
        state: { type: 'string' }
      },
      required: ['incidentId', 'note']
    }
  }
];

const liveScopes = ['useraccount', 'sn_requests.write', 'sn_incidents.read'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'servicenow',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'ServiceNow access was revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect ServiceNow before incident workflows run again.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'servicenow',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'ServiceNow requires reauthorization.',
      signals: [connection.reauth_required_reason ?? 'ServiceNow flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'servicenow',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'ServiceNow is missing required scopes for live tools.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect ServiceNow to restore incident/update support.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'servicenow',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'ServiceNow incident and request tooling is healthy.',
    signals: ['OAuth grant active', 'Instance metadata present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const serviceNowIntegration: IntegrationDefinition = {
  id: 'servicenow',
  displayName: 'ServiceNow',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes, providerConfig }) {
    if (!providerConfig?.instanceUrl) {
      throw new Error('ServiceNow connect requires instanceUrl provider config.');
    }

    const instanceUrl = new URL(providerConfig.instanceUrl).origin.replace(/\/$/, '');
    const url = new URL(`${instanceUrl}/oauth_auth.do`);
    const { clientId } = getCredentials();
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
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
    if (!accessToken) throw new Error('Missing ServiceNow access token.');

    const instanceUrl = getInstanceUrl(undefined, context.connection.metadata as Record<string, Json> | null | undefined);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    };

    if (toolName === 'servicenow.search_incidents') {
      const query = String(input.query ?? '');
      const limit = Number(input.limit ?? 25);
      const response = await fetch(
        `${instanceUrl}/api/now/table/incident?sysparm_limit=${Number.isFinite(limit) ? limit : 25}&sysparm_query=${encodeURIComponent(`short_descriptionLIKE${query}`)}`,
        { headers }
      );
      const data = await response.json();
      if (!response.ok) {
        const responseError = data as { error?: string | { message?: string } };
        const errorMessage =
          typeof responseError.error === 'string'
            ? responseError.error
            : typeof responseError.error === 'object' && responseError.error != null
              ? String(responseError.error.message ?? 'ServiceNow incident search failed.')
              : 'ServiceNow incident search failed.';
        throw new Error(errorMessage);
      }
      return data;
    }

    if (toolName === 'servicenow.update_request' || toolName === 'servicenow.add_incident_comment') {
      const requestId = String((toolName === 'servicenow.add_incident_comment' ? input.incidentId : input.requestId) ?? '').trim();
      const note = String(input.note ?? '');
      const state = String(input.state ?? '').trim();
      if (!requestId) throw new Error('incidentId (or requestId) is required for ServiceNow incident comments.');
      const updatePayload: { state?: string; comments?: string } = {};
      if (note) {
        updatePayload.comments = note;
      }
      if (state) {
        updatePayload.state = state;
      }
      if (!updatePayload.comments && !updatePayload.state) {
        throw new Error('A note or state is required for ServiceNow request updates.');
      }

      const response = await fetch(`${instanceUrl}/api/now/table/incident/${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(updatePayload)
      });
      const data = await response.json();
      if (!response.ok) {
        const responseError = data as { error?: string | { message?: string } };
        const errorMessage =
          typeof responseError.error === 'string'
            ? responseError.error
            : typeof responseError.error === 'object' && responseError.error != null
              ? String(responseError.error.message ?? 'ServiceNow request update failed.')
              : 'ServiceNow request update failed.';
        throw new Error(errorMessage);
      }
      return data;
    }

    throw new Error(`Unknown ServiceNow tool: ${toolName}`);
  }
};
