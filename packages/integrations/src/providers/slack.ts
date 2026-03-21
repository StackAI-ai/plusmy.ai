import { getServerEnv } from '@plusmy/config';
import type { ConnectionRecord, Json, McpResourceDefinition, McpToolDefinition, ProviderTokenSet } from '@plusmy/contracts';
import type { AuthorizationCodeInput, AuthorizationUrlInput, IntegrationDefinition, ProviderCallContext, ResolvedProviderAccount } from '../types';

const oauth = {
  authorizationUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access',
  defaultScopes: ['channels:read', 'channels:history', 'groups:history', 'chat:write']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    throw new Error('Slack OAuth credentials are missing.');
  }
  return { clientId: env.SLACK_CLIENT_ID, clientSecret: env.SLACK_CLIENT_SECRET };
}

async function exchange(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data.ok === false) {
    throw new Error(String(data.error ?? 'Slack token exchange failed.'));
  }

  const expiresIn = data.expires_in ? Number(data.expires_in) : undefined;
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: 'Bearer',
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: String(data.scope ?? oauth.defaultScopes.join(',')).split(/[, ]/).filter(Boolean),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

function resolveWorkspace(data: Record<string, unknown>): ResolvedProviderAccount {
  const team = (data.team ?? {}) as Record<string, unknown>;
  return {
    externalAccountId: String(team.id ?? data.bot_user_id ?? 'slack-workspace'),
    displayName: String(team.name ?? 'Slack workspace'),
    externalAccountEmail: null,
    metadata: data
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'slack.list_channels',
    title: 'List Slack channels',
    description: 'List public channels available to the connection.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 25 } } }
  },
  {
    name: 'slack.read_channel_history',
    title: 'Read channel history',
    description: 'Read messages from a Slack channel.',
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, limit: { type: 'number', default: 20 } },
      required: ['channel']
    }
  },
  {
    name: 'slack.post_message',
    title: 'Post Slack message',
    description: 'Post a message to a Slack channel.',
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, text: { type: 'string' } },
      required: ['channel', 'text']
    }
  }
];

export const slackIntegration: IntegrationDefinition = {
  id: 'slack',
  displayName: 'Slack',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(','));
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
    if (!response.ok || data.ok === false) {
      throw new Error(String(data.error ?? 'Slack token refresh failed.'));
    }
    const expiresIn = data.expires_in ? Number(data.expires_in) : undefined;
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
      tokenType: 'Bearer',
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      scopes: String(data.scope ?? oauth.defaultScopes.join(',')).split(/[, ]/).filter(Boolean),
      raw: data as Json
    };
  },
  async resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveWorkspace(tokenSet.raw as Record<string, unknown>);
  },
  listTools(_connection: ConnectionRecord) {
    return tools;
  },
  listResources(_connection: ConnectionRecord): McpResourceDefinition[] {
    return [];
  },
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing Slack access token.');

    if (toolName === 'slack.list_channels') {
      const limit = Number(input.limit ?? 25);
      const url = new URL('https://slack.com/api/conversations.list');
      url.searchParams.set('limit', String(limit));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      return await response.json();
    }

    if (toolName === 'slack.read_channel_history') {
      const url = new URL('https://slack.com/api/conversations.history');
      url.searchParams.set('channel', String(input.channel ?? ''));
      url.searchParams.set('limit', String(Number(input.limit ?? 20)));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      return await response.json();
    }

    if (toolName === 'slack.post_message') {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ channel: input.channel, text: input.text })
      });
      return await response.json();
    }

    throw new Error(`Unsupported Slack tool: ${toolName}`);
  }
};
