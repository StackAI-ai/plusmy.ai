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
  authorizationUrl: 'https://linear.app/oauth/authorize',
  tokenUrl: 'https://api.linear.app/oauth/token',
  defaultScopes: ['read', 'write', 'issues:create']
};

type LinearGraphResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) {
    throw new Error('Linear OAuth credentials are missing.');
  }
  return { clientId: env.LINEAR_CLIENT_ID, clientSecret: env.LINEAR_CLIENT_SECRET };
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

function throwIfGraphError(response: Record<string, unknown>, action: string) {
  const payload = response as LinearGraphResponse<unknown>;
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(String(payload.errors[0]?.message ?? `${action} failed.`));
  }
}

async function linearGraphRequest<T>(accessToken: string, query: string, variables: Record<string, unknown>) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: accessToken
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = (await response.json()) as LinearGraphResponse<T>;
  if (!response.ok) {
    throwIfGraphError(payload as Record<string, unknown>, 'Linear API');
    throw new Error(String((payload as Record<string, unknown>).error ?? 'Linear API request failed.'));
  }
  throwIfGraphError(payload as Record<string, unknown>, 'Linear API');
  return payload.data as T;
}

async function exchange(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code
    })
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((data as Record<string, string>).error ?? 'Linear token exchange failed.'));
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

async function refreshTokens(refreshToken: string) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error ?? 'Linear token refresh failed.'));
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

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const data = await linearGraphRequest<{ viewer: { id: string; name: string; email: string } }>(
    `Bearer ${accessToken}`,
    '{ viewer { id name email } }',
    {}
  );

  return {
    externalAccountId: String(data?.viewer?.id ?? 'linear-user'),
    displayName: String(data?.viewer?.name ?? 'Linear user'),
    externalAccountEmail: data?.viewer?.email ? String(data.viewer.email) : null,
    metadata: data as Record<string, unknown>
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Linear access token.');
  const account = await resolveAccount(accessToken);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: { ...(account.metadata as Record<string, Json>), synced_at: new Date().toISOString() }
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'linear.search_issues',
    title: 'Search Linear issues',
    description: 'Search issues with query keywords for backlog triage.',
    requiredProviderScopes: ['read'],
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
    name: 'linear.update_issue',
    title: 'Update Linear issue',
    description: 'Update state or assignment on an issue.',
    requiredProviderScopes: ['write'],
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string' },
        stateId: { type: 'string' },
        assigneeId: { type: 'string' }
      },
      required: ['issueId']
    }
  },
  {
    name: 'linear.create_comment',
    title: 'Create Linear comment',
    description: 'Create a follow-up comment on an issue.',
    requiredProviderScopes: ['write'],
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['issueId', 'body']
    }
  }
];

const liveScopes = ['read', 'write', 'issues:create'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'linear',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Linear connection was revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Linear before issue workflows resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'linear',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Linear needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Linear flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'linear',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Linear is missing scopes for one or more tools.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Linear to restore issue/search capabilities.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'linear',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Linear issue tooling is healthy.',
    signals: ['OAuth grant active', 'Linear GraphQL ready'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const linearIntegration: IntegrationDefinition = {
  id: 'linear',
  displayName: 'Linear',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    return exchange(code, redirectUri);
  },
  async refreshTokens({ refreshToken }) {
    return refreshTokens(refreshToken);
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveAccount(tokenSet.accessToken ?? '');
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
    if (!accessToken) throw new Error('Missing Linear access token.');
    const bearer = `Bearer ${accessToken}`;

    if (toolName === 'linear.search_issues') {
      const query = String(input.query ?? '').trim();
      const limit = Number(input.limit ?? 10);
      const data = await linearGraphRequest<{ issues: { nodes: Array<Record<string, unknown>> } }>(
        bearer,
        `query SearchIssues($query: String!, $limit: Int) { issues(filter: { search: $query }, first: $limit) { nodes { id title identifier url state { name } } } }`,
        { query, limit: Number.isFinite(limit) ? limit : 10 }
      );
      return data?.issues;
    }

    if (toolName === 'linear.update_issue') {
      const issueId = String(input.issueId ?? '').trim();
      const stateId = String(input.stateId ?? '').trim();
      const assigneeId = String(input.assigneeId ?? '').trim();
      if (!issueId) throw new Error('issueId is required to update an issue.');
      if (!stateId && !assigneeId) {
        throw new Error('Either stateId or assigneeId is required to update an issue.');
      }

      const inputPayload = {
        id: issueId,
        input: { ...(stateId ? { stateId } : {}), ...(assigneeId ? { assigneeId } : {}) }
      };

      const data = await linearGraphRequest<{ issueUpdate: { success?: boolean } }>(
        bearer,
        `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) { success issue { id identifier } }
        }`,
        { id: issueId, input: inputPayload.input }
      );
      return data?.issueUpdate;
    }

    if (toolName === 'linear.create_comment') {
      const issueId = String(input.issueId ?? '').trim();
      const body = String(input.body ?? '').trim();
      if (!issueId || !body) throw new Error('issueId and body are required for creating a comment.');

      const data = await linearGraphRequest<{ commentCreate: { success?: boolean } }>(
        bearer,
        `mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) { success comment { id body } }
        }`,
        { input: { issueId, body } }
      );
      return data?.commentCreate;
    }

    throw new Error(`Unknown Linear tool: ${toolName}`);
  }
};
