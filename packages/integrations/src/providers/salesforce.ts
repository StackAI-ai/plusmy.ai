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
  authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
  tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
  defaultScopes: ['api', 'refresh_token', 'openid']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.SALESFORCE_CLIENT_ID || !env.SALESFORCE_CLIENT_SECRET) {
    throw new Error('Salesforce OAuth credentials are missing.');
  }
  return { clientId: env.SALESFORCE_CLIENT_ID, clientSecret: env.SALESFORCE_CLIENT_SECRET };
}

function parseScopes(value: unknown, fallback: string[]) {
  if (typeof value !== 'string') return fallback;
  return value
    .split(' ')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeInstanceUrl(value: string | undefined | null) {
  if (!value) return '';
  try {
    return new URL(value).origin.replace(/\/$/, '');
  } catch {
    throw new Error('Invalid Salesforce instance URL.');
  }
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
    throw new Error(String(data.error_description ?? data.error ?? 'Salesforce token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

function getInstanceUrl(tokenSet: ProviderTokenSet) {
  const raw = tokenSet.raw as Record<string, unknown> | undefined;
  const instanceUrl = raw?.instance_url;
  const normalized = normalizeInstanceUrl(typeof instanceUrl === 'string' ? instanceUrl : null);
  if (!normalized) {
    throw new Error('Salesforce token is missing instance_url.');
  }
  return normalized;
}

async function resolveAccount(tokenSet: ProviderTokenSet): Promise<ResolvedProviderAccount> {
  const instanceUrl = getInstanceUrl(tokenSet);
  const response = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${tokenSet.accessToken}` }
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((data as Record<string, string>).error ?? 'Failed to resolve Salesforce account.'));
  }

  return {
    externalAccountId: String((data as Record<string, unknown>).user_id ?? 'salesforce-user'),
    displayName: String((data as Record<string, unknown>).preferred_username ?? data.username ?? 'Salesforce org'),
    externalAccountEmail: (data.email ? String(data.email) : null) as string | null,
    metadata: { ...data, instanceUrl }
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Salesforce access token.');

  const account = await resolveAccount(credentials as ProviderTokenSet);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'salesforce.search_accounts',
    title: 'Search Salesforce accounts',
    description: 'Search Salesforce accounts by a keyword query.',
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
    name: 'salesforce.create_case_comment',
    title: 'Update Salesforce case',
    description: 'Post a comment update to a Salesforce case.',
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
  },
  {
    name: 'salesforce.update_case',
    title: 'Update Salesforce case (legacy alias)',
    description: 'Legacy alias for Salesforce case updates; prefer salesforce.create_case_comment.',
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
];

const liveScopes = ['api'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'salesforce',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Salesforce connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Salesforce before CRM tools can run.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'salesforce',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Salesforce needs reauthorization before CRM tools can run.',
      signals: [connection.reauth_required_reason ?? 'Salesforce flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'salesforce',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Salesforce is missing one or more scopes required by live tool access.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Salesforce to restore account and case workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'salesforce',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Salesforce CRM access is healthy.',
    signals: ['OAuth grant active', 'API scope present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const salesforceIntegration: IntegrationDefinition = {
  id: 'salesforce',
  displayName: 'Salesforce',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    return exchange(code, redirectUri);
  },
  async refreshTokens({ refreshToken, metadata }) {
    const { clientId, clientSecret } = getCredentials();
    const instanceUrl = metadata?.instanceUrl;
    const tokenUrl =
      typeof instanceUrl === 'string' && instanceUrl.length > 0 ? `${normalizeInstanceUrl(instanceUrl)}/services/oauth2/token` : oauth.tokenUrl;

    const response = await fetch(tokenUrl, {
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
      throw new Error(String(data.error_description ?? data.error ?? 'Salesforce token refresh failed.'));
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
    const tokenSet = context.credentials as ProviderTokenSet;
    const accessToken = tokenSet.accessToken;
    if (!accessToken) throw new Error('Missing Salesforce access token.');

    const instanceUrl = normalizeInstanceUrl((context.connection.metadata as Record<string, unknown> | null)?.instanceUrl as string | undefined);
    if (!instanceUrl) {
      throw new Error('Salesforce connection is missing instance metadata. Reconnect this install.');
    }

    if (toolName === 'salesforce.search_accounts') {
      const query = String(input.query ?? '');
      const limit = Number(input.limit ?? 25);
      const response = await fetch(
        `${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(`SELECT Id, Name FROM Account WHERE Name LIKE '%${query}%' LIMIT ${Number.isFinite(limit) ? limit : 25}`)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return await response.json();
    }

    if (toolName === 'salesforce.create_case_comment' || toolName === 'salesforce.update_case') {
      const caseId = String(input.caseId ?? '');
      const status = String(input.status ?? '');
      const comment = String(input.comment ?? '');
      const response = await fetch(`${instanceUrl}/services/data/v60.0/sobjects/Case/${encodeURIComponent(caseId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ Status: status, Description: comment })
      });
      return await response.json();
    }

    throw new Error(`Unknown tool: ${toolName}`);
  }
};
