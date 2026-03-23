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
  authorizationUrl: 'https://app.asana.com/-/oauth_authorize',
  tokenUrl: 'https://app.asana.com/-/oauth_token',
  defaultScopes: ['default']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.ASANA_CLIENT_ID || !env.ASANA_CLIENT_SECRET) {
    throw new Error('Asana OAuth credentials are missing.');
  }
  return { clientId: env.ASANA_CLIENT_ID, clientSecret: env.ASANA_CLIENT_SECRET };
}

function parseScopes(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value
    .split(' ')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getAsanaErrorMessage(data: Record<string, unknown>) {
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const firstError = errors[0];
  if (firstError && typeof firstError === 'object' && !Array.isArray(firstError)) {
    const message = firstError.message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return null;
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
    throw new Error(String(data.error_description ?? data.error ?? 'Asana token exchange failed.'));
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

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const response = await fetch('https://app.asana.com/api/1.0/users/me?opt_fields=id,name,email,workspaces.gid,workspaces.name', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(getAsanaErrorMessage(data) ?? 'Failed to resolve Asana account.');
  }

  const user = (data.data ?? {}) as Record<string, unknown>;
  const workspaces = Array.isArray(user.workspaces) ? user.workspaces : [];
  return {
    externalAccountId: String(user.id ?? 'asana-user'),
    displayName: String(user.name ?? 'Asana workspace'),
    externalAccountEmail: typeof user.email === 'string' ? user.email : null,
    metadata: { user, workspaces }
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Asana access token.');
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
    name: 'asana.search_tasks',
    title: 'Search Asana tasks',
    description: 'Search Asana tasks across user-linked workspaces.',
    requiredProviderScopes: ['default'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        workspaceId: { type: 'string' },
        limit: { type: 'number', default: 25 }
      },
      required: ['query']
    }
  },
  {
    name: 'asana.comment_on_task',
    title: 'Comment on Asana task',
    description: 'Create a comment for an Asana task to keep work visible across teams.',
    requiredProviderScopes: ['default'],
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['taskId', 'body']
    }
  }
];

const liveScopes = ['default'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'asana',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Asana connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Asana before task tools resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'asana',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Asana needs reauthorization before task tools can run.',
      signals: [connection.reauth_required_reason ?? 'Asana flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'asana',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Asana is missing one or more scopes required by the live task tools.',
      signals: [
        `Missing scopes: ${missingScopes.join(', ')}`,
        'Reconnect Asana to restore task lookup and comment workflows.'
      ],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'asana',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Asana task lookup and comment access is healthy.',
    signals: ['OAuth grant active', 'Asana scopes present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const asanaIntegration: IntegrationDefinition = {
  id: 'asana',
  displayName: 'Asana',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
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
      throw new Error(String(data.error_description ?? data.error ?? 'Asana token refresh failed.'));
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
  syncJobs: [{ jobType: 'sync_connection', run: syncConnection }],
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing Asana access token.');

    const metadata = context.connection.metadata;
    const metadataWorkspace = (metadata as Record<string, unknown> | null)?.workspaces;
    const workspaceId = String(
      input.workspaceId ??
        (Array.isArray(metadataWorkspace) && metadataWorkspace[0] && typeof metadataWorkspace[0] === 'object'
          ? (metadataWorkspace[0] as Record<string, unknown>).gid ?? (metadataWorkspace[0] as Record<string, unknown>).id
          : null) ??
        ''
    ).trim();

    if (toolName === 'asana.search_tasks') {
      if (!workspaceId) {
        throw new Error('Asana task search requires workspaceId or a connected workspace in account metadata.');
      }
      const query = String(input.query ?? '');
      const limit = Number(input.limit ?? 25);
      const response = await fetch(
        `https://app.asana.com/api/1.0/workspaces/${encodeURIComponent(workspaceId)}/tasks/search?limit=${Number.isFinite(limit) ? limit : 25}&text=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return await response.json();
    }

    if (toolName === 'asana.comment_on_task') {
      const taskId = String(input.taskId ?? '');
      const body = String(input.body ?? '');
      const response = await fetch(`https://app.asana.com/api/1.0/tasks/${encodeURIComponent(taskId)}/stories`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: body })
      });
      return await response.json();
    }

    throw new Error(`Unknown tool: ${toolName}`);
  }
};
