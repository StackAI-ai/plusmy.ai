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
  authorizationUrl: 'https://auth.atlassian.com/authorize',
  tokenUrl: 'https://auth.atlassian.com/oauth/token',
  defaultScopes: ['read:jira-work', 'write:jira-work', 'offline_access']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET) {
    throw new Error('Jira OAuth credentials are missing.');
  }
  return { clientId: env.JIRA_CLIENT_ID, clientSecret: env.JIRA_CLIENT_SECRET };
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

function jiraApiRoot(metadata: Record<string, Json> | null | undefined, cloudId: string | null) {
  const configuredCloudId = typeof metadata?.cloudId === 'string' ? metadata.cloudId : '';
  const resolvedCloudId = cloudId ?? configuredCloudId;
  if (!resolvedCloudId) throw new Error('Jira cloudId is missing.');
  return `https://api.atlassian.com/ex/jira/${resolvedCloudId}`;
}

function getJiraErrorMessage(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const errorMessages = Array.isArray((data as Record<string, unknown>).errorMessages)
    ? ((data as Record<string, unknown>).errorMessages as unknown[])
    : [];
  const firstError = errorMessages[0];
  return typeof firstError === 'string' && firstError.length > 0 ? firstError : null;
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
    throw new Error(String((data as Record<string, string>).error_description ?? data.error ?? 'Jira token exchange failed.'));
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
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error ?? 'Jira token refresh failed.'));
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

async function resolveCloudMetadata(accessToken: string) {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const resources = (await response.json()) as Record<string, unknown>[];
  if (!response.ok || !Array.isArray(resources) || resources.length === 0) {
    throw new Error('Failed to resolve Jira cloud site metadata.');
  }
  return resources[0] as Record<string, unknown>;
}

async function resolveAccount(accessToken: string, metadata: Record<string, Json> | null | undefined): Promise<ResolvedProviderAccount> {
  const cloud = await resolveCloudMetadata(accessToken);
  const apiRoot = jiraApiRoot(metadata, String(cloud.id ?? ''));
  const response = await fetch(`${apiRoot}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((data as Record<string, string>).message ?? 'Failed to resolve Jira account.'));
  }

  return {
    externalAccountId: String(data.accountId ?? 'jira-user'),
    displayName: String(data.displayName ?? 'Jira user'),
    externalAccountEmail: String(data.emailAddress ?? '') || null,
    metadata: { ...cloud, ...data }
  };
}

async function syncConnection({ credentials, connection }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Jira access token.');
  const account = await resolveAccount(accessToken, connection.metadata as Record<string, Json> | null | undefined);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'jira.search_issues',
    title: 'Search Jira issues',
    description: 'Search Jira issues by JQL.',
    requiredProviderScopes: ['read:jira-work'],
    inputSchema: {
      type: 'object',
      properties: {
        jql: { type: 'string' },
        maxResults: { type: 'number', default: 25 }
      },
      required: ['jql']
    }
  },
  {
    name: 'jira.transition_issue',
    title: 'Transition Jira issue',
    description: 'Transition an issue through workflow states.',
    requiredProviderScopes: ['write:jira-work'],
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: { type: 'string' },
        transitionId: { type: 'string' }
      },
      required: ['issueKey', 'transitionId']
    }
  },
  {
    name: 'jira.create_comment',
    title: 'Create Jira comment',
    description: 'Post a comment on a Jira issue.',
    requiredProviderScopes: ['write:jira-work'],
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['issueKey', 'body']
    }
  }
];

const liveScopes = ['read:jira-work', 'write:jira-work'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'jira',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Jira connection was revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Jira before issue workflows resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'jira',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Jira needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Jira flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'jira',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Jira is missing required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Jira to restore read/write tooling.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'jira',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Jira issue and workflow tools are healthy.',
    signals: ['OAuth grant active', 'Jira cloud metadata present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const jiraIntegration: IntegrationDefinition = {
  id: 'jira',
  displayName: 'Jira',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('audience', 'api.atlassian.com');
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
  refreshTokens({ refreshToken }) {
    return refreshTokens(refreshToken);
  },
  async resolveAccount(tokenSet: ProviderTokenSet) {
    const accessToken = tokenSet.accessToken ?? '';
    if (!accessToken) throw new Error('Missing Jira access token.');
    return resolveAccount(accessToken, tokenSet.raw as Record<string, Json> | null | undefined);
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
    if (!accessToken) throw new Error('Missing Jira access token.');

    const metadata = context.connection.metadata as Record<string, Json> | null | undefined;
    const cloudId = typeof metadata?.cloudId === 'string' ? metadata.cloudId : '';
    const apiRoot = jiraApiRoot(metadata, cloudId);
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' };

    if (toolName === 'jira.search_issues') {
      const jql = String(input.jql ?? '').trim();
      const maxResults = Number(input.maxResults ?? 25);
      const response = await fetch(
        `${apiRoot}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${Number.isFinite(maxResults) ? maxResults : 25}`,
        { headers }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(getJiraErrorMessage(data) ?? 'Jira issue search failed.');
      }
      return data;
    }

    if (toolName === 'jira.transition_issue') {
      const issueKey = String(input.issueKey ?? '').trim();
      const transitionId = String(input.transitionId ?? '').trim();
      if (!issueKey || !transitionId) {
        throw new Error('issueKey and transitionId are required for issue transitions.');
      }
      const response = await fetch(`${apiRoot}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ transition: { id: transitionId } })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(getJiraErrorMessage(data) ?? 'Jira transition failed.');
      }
      return data;
    }

    if (toolName === 'jira.create_comment') {
      const issueKey = String(input.issueKey ?? '').trim();
      const body = String(input.body ?? '').trim();
      if (!issueKey || !body) {
        throw new Error('issueKey and body are required for Jira comments.');
      }
      const response = await fetch(`${apiRoot}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: { content: [{ type: 'text', text: body }] } })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(getJiraErrorMessage(data) ?? 'Jira comment failed.');
      }
      return data;
    }

    throw new Error(`Unknown Jira tool: ${toolName}`);
  }
};
