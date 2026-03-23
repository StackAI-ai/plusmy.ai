import { getServerEnv } from '@plusmy/config';
import type {
  ConnectionRecord,
  Json,
  McpResourceDefinition,
  McpToolDefinition,
  ProviderHealthSnapshot,
  ProviderTokenSet
} from '@plusmy/contracts';
import type { AuthorizationCodeInput, AuthorizationUrlInput, IntegrationDefinition, ProviderCallContext, ResolvedProviderAccount, SyncJobHandlerInput } from '../types';
import { getMissingScopes } from '../scope-drift';

const oauth = {
  authorizationUrl: 'https://auth.monday.com/oauth2/authorize',
  tokenUrl: 'https://auth.monday.com/oauth2/token',
  defaultScopes: ['me:read', 'boards:read', 'boards:write']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.MONDAY_CLIENT_ID || !env.MONDAY_CLIENT_SECRET) {
    throw new Error('monday.com OAuth credentials are missing.');
  }
  return { clientId: env.MONDAY_CLIENT_ID, clientSecret: env.MONDAY_CLIENT_SECRET };
}

function parseScopes(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value
    .split(/[ ,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function throwIfGraphError(payload: Record<string, unknown>) {
  const errors = payload.errors as { message?: unknown }[] | undefined;
  if (!errors || errors.length === 0) return;
  const message = typeof errors[0]?.message === 'string' ? errors[0]?.message : 'monday.com API request failed.';
  throw new Error(message);
}

async function mondayGraphRequest<T>(accessToken: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throwIfGraphError(payload);
    throw new Error('monday.com API request failed.');
  }
  throwIfGraphError(payload);
  return payload.data as T;
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
    throw new Error(String(data.error_description ?? data.error ?? 'monday.com token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: 'Bearer',
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(String(data.scope ?? oauth.defaultScopes.join(' ')), oauth.defaultScopes),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

async function refreshTokens(refreshToken: string) {
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
    throw new Error(String(data.error_description ?? data.error ?? 'monday.com token refresh failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
    tokenType: 'Bearer',
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(String(data.scope ?? oauth.defaultScopes.join(' ')), oauth.defaultScopes),
    raw: data as Json
  };
}

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const data = await mondayGraphRequest<{ me: { id: string; name: string; email: string } }>(
    accessToken,
    `
      query {
        me {
          id
          name
          email
        }
      }
    `,
    {}
  );

  return {
    externalAccountId: String(data?.me?.id ?? 'monday-user'),
    displayName: String(data?.me?.name ?? 'monday.com account'),
    externalAccountEmail: typeof data?.me?.email === 'string' ? data.me.email : null,
    metadata: data as Record<string, unknown>
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing monday.com access token.');
  const account = await resolveAccount(accessToken);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'monday.search_boards',
    title: 'Search monday.com boards',
    description: 'Find boards by keyword and metadata for CRM and ops workflows.',
    requiredProviderScopes: ['boards:read'],
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
    name: 'monday.update_item',
    title: 'Update monday.com item',
    description: 'Post an update to a board item for operators and project tracking.',
    requiredProviderScopes: ['boards:write'],
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['itemId', 'body']
    }
  }
];

const liveScopes = oauth.defaultScopes;

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'monday',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This monday.com connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect monday.com before workspace tools resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'monday',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'monday.com needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'monday.com flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'monday',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'monday.com is missing required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect monday.com to restore board search and item update tools.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'monday',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'monday.com board and update tools are healthy.',
    signals: ['OAuth grant active', 'Boards and write scope present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const mondayIntegration = {
  id: 'monday',
  displayName: 'monday.com',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    return exchange(code, redirectUri);
  },
  refreshTokens({ refreshToken }) {
    return refreshTokens(String(refreshToken));
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    const accessToken = tokenSet.accessToken ?? '';
    if (!accessToken) throw new Error('Missing monday.com access token.');
    return resolveAccount(accessToken);
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
    if (!accessToken) throw new Error('Missing monday.com access token.');

    if (toolName === 'monday.search_boards') {
      const query = String(input.query ?? '').trim();
      const limit = Number(input.limit ?? 25);
      if (!query) throw new Error('query is required to search boards.');
      const resolvedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 25;
      const data = await mondayGraphRequest<{ boards: { id: string; name: string }[] }>(
        accessToken,
        `
          query SearchBoards($limit: Int!) {
            boards(limit: $limit) {
              id
              name
            }
          }
        `,
        { limit: resolvedLimit }
      );

      const matched = (data.boards ?? []).filter((board) =>
        String(board.name ?? '').toLowerCase().includes(query.toLowerCase())
      );
      return {
        query,
        totalFound: matched.length,
        boards: matched
      };
    }

    if (toolName === 'monday.update_item') {
      const itemId = String(input.itemId ?? '').trim();
      const body = String(input.body ?? '').trim();
      if (!itemId) throw new Error('itemId is required.');
      if (!body) throw new Error('body is required.');

      return mondayGraphRequest(
        accessToken,
        `
          mutation UpdateItem($itemId: String!, $body: String!) {
            create_update(item_id: $itemId, body: $body) {
              id
              text
            }
          }
        `,
        { itemId, body }
      );
    }

    throw new Error(`Unknown monday.com tool: ${toolName}`);
  }
} satisfies IntegrationDefinition;
