import { getServerEnv } from '@plusmy/config';
import type { ConnectionRecord, McpResourceDefinition, McpToolDefinition, ProviderTokenSet } from '@plusmy/contracts';
import type { AuthorizationCodeInput, AuthorizationUrlInput, IntegrationDefinition, ProviderCallContext, ResolvedProviderAccount } from '../types';

const oauth = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  defaultScopes: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ]
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials are missing.');
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
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
    throw new Error(String(data.error_description ?? data.error ?? 'Google token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes: String(data.scope ?? oauth.defaultScopes.join(' ')).split(' ').filter(Boolean),
    raw: data
  } satisfies ProviderTokenSet;
}

async function fetchProfile(accessToken: string): Promise<ResolvedProviderAccount> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error?.toString() ?? 'Failed to resolve Google account.'));
  }
  return {
    externalAccountId: String(data.id ?? data.email ?? 'google-account'),
    displayName: String(data.name ?? data.email ?? 'Google Workspace'),
    externalAccountEmail: data.email ? String(data.email) : null,
    metadata: data as Record<string, unknown>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'google.search_drive',
    title: 'Search Google Drive',
    description: 'Search Drive files by full text query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        pageSize: { type: 'number', default: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'google.get_document',
    title: 'Get Google Doc',
    description: 'Fetch a Google Docs document by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string' }
      },
      required: ['documentId']
    }
  }
];

export const googleIntegration: IntegrationDefinition = {
  id: 'google',
  displayName: 'Google Workspace',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
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
      throw new Error(String(data.error_description ?? data.error ?? 'Google token refresh failed.'));
    }
    const expiresIn = Number(data.expires_in ?? 3600);
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken,
      tokenType: String(data.token_type ?? 'Bearer'),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: String(data.scope ?? oauth.defaultScopes.join(' ')).split(' ').filter(Boolean),
      raw: data
    };
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    return fetchProfile(String(tokenSet.accessToken ?? ''));
  },
  listTools(_connection: ConnectionRecord) {
    return tools;
  },
  listResources(_connection: ConnectionRecord): McpResourceDefinition[] {
    return [];
  },
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing Google access token.');

    if (toolName === 'google.search_drive') {
      const query = String(input.query ?? '');
      const pageSize = Number(input.pageSize ?? 10);
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('pageSize', String(pageSize));
      url.searchParams.set('q', `fullText contains '${query.replace(/'/g, "\\'")}'`);
      url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink)');
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      return await response.json();
    }

    if (toolName === 'google.get_document') {
      const documentId = String(input.documentId ?? '');
      const response = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return await response.json();
    }

    throw new Error(`Unsupported Google tool: ${toolName}`);
  }
};
