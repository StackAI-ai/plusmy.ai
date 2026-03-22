import { Buffer } from 'node:buffer';
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
  authorizationUrl: 'https://account.box.com/api/oauth2/authorize',
  tokenUrl: 'https://api.box.com/oauth2/token',
  defaultScopes: ['item_search', 'item_read']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.BOX_CLIENT_ID || !env.BOX_CLIENT_SECRET) {
    throw new Error('Box OAuth credentials are missing.');
  }
  return { clientId: env.BOX_CLIENT_ID, clientSecret: env.BOX_CLIENT_SECRET };
}

async function exchangeToken(body: URLSearchParams) {
  const { clientId, clientSecret } = getCredentials();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);

  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'Box token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: oauth.defaultScopes.slice(),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const response = await fetch('https://api.box.com/2.0/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.message ?? data.error ?? 'Failed to resolve Box account.'));
  }

  return {
    externalAccountId: String(data.id ?? 'box-account'),
    displayName: String(data.name ?? data.login ?? 'Box account'),
    externalAccountEmail: data.login ? String(data.login) : null,
    metadata: data
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Box access token.');

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
    name: 'box.search_files',
    title: 'Search Box files',
    description: 'Search Box files and folders by query.',
    requiredProviderScopes: ['item_search'],
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
    name: 'box.read_file',
    title: 'Read Box file',
    description: 'Read Box file content by file id.',
    requiredProviderScopes: ['item_read'],
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' }
      },
      required: ['fileId']
    }
  }
];

const liveScopes = ['item_search', 'item_read'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'box',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Box connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Box before file search or reads resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'box',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Box needs reauthorization before file search or reads can run.',
      signals: [connection.reauth_required_reason ?? 'Box flagged the install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'box',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Box is missing one or more scopes required by the live tool set.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Box to restore file search and read coverage.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'box',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Box file search and read access is healthy.',
    signals: ['OAuth grant active', 'Box read scopes present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

async function serializeFileResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const textLike = contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml');

  return {
    contentType,
    sizeBytes: buffer.byteLength,
    text: textLike ? buffer.toString('utf8') : null,
    base64: textLike ? null : buffer.toString('base64')
  };
}

export const boxIntegration: IntegrationDefinition = {
  id: 'box',
  displayName: 'Box',
  oauth,
  buildAuthorizationUrl({ redirectUri, state }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    return exchangeToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    );
  },
  async refreshTokens({ refreshToken }) {
    const tokenSet = await exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    );

    return {
      ...tokenSet,
      refreshToken: tokenSet.refreshToken ?? refreshToken
    };
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveAccount(String(tokenSet.accessToken ?? ''));
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
    if (!accessToken) throw new Error('Missing Box access token.');

    if (toolName === 'box.search_files') {
      const url = new URL('https://api.box.com/2.0/search');
      url.searchParams.set('query', String(input.query ?? ''));
      url.searchParams.set('limit', String(Number(input.limit ?? 10)));
      url.searchParams.set('type', 'file');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      return await response.json();
    }

    if (toolName === 'box.read_file') {
      const response = await fetch(`https://api.box.com/2.0/files/${String(input.fileId ?? '')}/content`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Box file read failed.');
      }

      return await serializeFileResponse(response);
    }

    throw new Error(`Unknown Box tool: ${toolName}`);
  }
};
