import { getServerEnv } from '@plusmy/config';
import type { ConnectionRecord, Json, McpResourceDefinition, McpToolDefinition, ProviderTokenSet } from '@plusmy/contracts';
import type { AuthorizationCodeInput, AuthorizationUrlInput, IntegrationDefinition, ProviderCallContext } from '../types';

const oauth = {
  authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
  tokenUrl: 'https://api.notion.com/v1/oauth/token',
  defaultScopes: ['read', 'write']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
    throw new Error('Notion OAuth credentials are missing.');
  }
  return { clientId: env.NOTION_CLIENT_ID, clientSecret: env.NOTION_CLIENT_SECRET };
}

async function notionRequest(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': '2022-06-28',
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  return await response.json();
}

const tools: McpToolDefinition[] = [
  {
    name: 'notion.search',
    title: 'Search Notion',
    description: 'Search pages and databases inside Notion.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    }
  },
  {
    name: 'notion.get_page',
    title: 'Get Notion page',
    description: 'Read a Notion page by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' }
      },
      required: ['pageId']
    }
  },
  {
    name: 'notion.create_page',
    title: 'Create Notion page',
    description: 'Create a page under a parent page or database.',
    inputSchema: {
      type: 'object',
      properties: {
        parent: { type: 'object' },
        properties: { type: 'object' },
        children: { type: 'array' }
      },
      required: ['parent', 'properties']
    }
  }
];

export const notionIntegration: IntegrationDefinition = {
  id: 'notion',
  displayName: 'Notion',
  oauth,
  buildAuthorizationUrl({ redirectUri, state }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('owner', 'user');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  },
  async exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    const { clientId, clientSecret } = getCredentials();
    const response = await fetch(oauth.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(data.error_description ?? data.error ?? 'Notion token exchange failed.'));
    }
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken: data.refresh_token ? String(data.refresh_token) : null,
      tokenType: 'Bearer',
      expiresAt: null,
      scopes: oauth.defaultScopes,
      raw: data as Json
    };
  },
  async refreshTokens({ refreshToken }) {
    const { clientId, clientSecret } = getCredentials();
    const response = await fetch(oauth.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken })
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(data.error_description ?? data.error ?? 'Notion token refresh failed.'));
    }
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
      tokenType: 'Bearer',
      expiresAt: null,
      scopes: oauth.defaultScopes,
      raw: data as Json
    };
  },
  async resolveAccount(tokenSet) {
    const data = tokenSet.raw as Record<string, unknown>;
    return {
      externalAccountId: String(data.workspace_id ?? data.bot_id ?? 'notion-workspace'),
      displayName: String(data.workspace_name ?? 'Notion workspace'),
      externalAccountEmail: null,
      metadata: data
    };
  },
  listTools(_connection: ConnectionRecord) {
    return tools;
  },
  listResources(_connection: ConnectionRecord): McpResourceDefinition[] {
    return [];
  },
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing Notion access token.');

    if (toolName === 'notion.search') {
      return await notionRequest('search', accessToken, {
        method: 'POST',
        body: JSON.stringify({ query: input.query ?? '' })
      });
    }

    if (toolName === 'notion.get_page') {
      return await notionRequest(`pages/${String(input.pageId ?? '')}`, accessToken, { method: 'GET' });
    }

    if (toolName === 'notion.create_page') {
      return await notionRequest('pages', accessToken, {
        method: 'POST',
        body: JSON.stringify({ parent: input.parent, properties: input.properties, children: input.children ?? [] })
      });
    }

    throw new Error(`Unsupported Notion tool: ${toolName}`);
  }
};
