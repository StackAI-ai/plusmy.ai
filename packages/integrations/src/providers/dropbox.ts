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
  authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  defaultScopes: ['account_info.read', 'files.metadata.read', 'files.content.read']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET) {
    throw new Error('Dropbox OAuth credentials are missing.');
  }
  return { clientId: env.DROPBOX_CLIENT_ID, clientSecret: env.DROPBOX_CLIENT_SECRET };
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
    throw new Error(String(data.error_description ?? data.error_summary ?? data.error ?? 'Dropbox token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 14400);
  const scopeValue = String(data.scope ?? oauth.defaultScopes.join(' '));
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: scopeValue.split(' ').filter(Boolean),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: 'null'
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_summary ?? data.error ?? 'Failed to resolve Dropbox account.'));
  }

  const name = (data.name ?? {}) as Record<string, unknown>;
  return {
    externalAccountId: String(data.account_id ?? 'dropbox-account'),
    displayName: String(name.display_name ?? data.email ?? 'Dropbox account'),
    externalAccountEmail: data.email ? String(data.email) : null,
    metadata: data
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Dropbox access token.');

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
    name: 'dropbox.search_files',
    title: 'Search Dropbox files',
    description: 'Search Dropbox files and folders by query.',
    requiredProviderScopes: ['files.metadata.read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 10 },
        filenameOnly: { type: 'boolean', default: false }
      },
      required: ['query']
    }
  },
  {
    name: 'dropbox.read_file',
    title: 'Read Dropbox file',
    description: 'Read Dropbox file content by path.',
    requiredProviderScopes: ['files.content.read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  }
];

const liveScopes = ['files.metadata.read', 'files.content.read'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'dropbox',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Dropbox connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Dropbox before file search or reads resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'dropbox',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Dropbox needs reauthorization before file search or reads can run.',
      signals: [connection.reauth_required_reason ?? 'Dropbox flagged the install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'dropbox',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Dropbox is missing one or more scopes required by the live tool set.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Dropbox to restore file search and read coverage.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'dropbox',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Dropbox file search and read access is healthy.',
    signals: ['OAuth grant active', 'Dropbox read scopes present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

async function serializeFileResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const fileMetadataHeader = response.headers.get('dropbox-api-result');
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const textLike = contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml');

  let metadata: Record<string, unknown> | null = null;
  if (fileMetadataHeader) {
    try {
      metadata = JSON.parse(fileMetadataHeader) as Record<string, unknown>;
    } catch {
      metadata = { raw: fileMetadataHeader };
    }
  }

  return {
    contentType,
    sizeBytes: buffer.byteLength,
    metadata,
    text: textLike ? buffer.toString('utf8') : null,
    base64: textLike ? null : buffer.toString('base64')
  };
}

export const dropboxIntegration: IntegrationDefinition = {
  id: 'dropbox',
  displayName: 'Dropbox',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('scope', scopes.join(' '));
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
    if (!accessToken) throw new Error('Missing Dropbox access token.');

    if (toolName === 'dropbox.search_files') {
      const response = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          query: String(input.query ?? ''),
          options: {
            max_results: Number(input.limit ?? 10),
            filename_only: Boolean(input.filenameOnly ?? false)
          }
        })
      });

      return await response.json();
    }

    if (toolName === 'dropbox.read_file') {
      const response = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: String(input.path ?? '') })
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Dropbox file read failed.');
      }

      return await serializeFileResponse(response);
    }

    throw new Error(`Unknown Dropbox tool: ${toolName}`);
  }
};
