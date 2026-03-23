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
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  defaultScopes: ['read:user', 'repo', 'read:org']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new Error('GitHub OAuth credentials are missing.');
  }
  return { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
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

function headers(accessToken: string) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function exchange(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code'
    })
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'GitHub token exchange failed.'));
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
    headers: { Accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data.error_description ?? data.error ?? 'GitHub token refresh failed.'));
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
  const response = await fetch('https://api.github.com/user', { headers: headers(accessToken) });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String((data as Record<string, string>).message ?? 'GitHub account resolve failed.'));
  }

  return {
    externalAccountId: String(data.id ?? 'github-user'),
    displayName: String(data.login ?? 'GitHub account'),
    externalAccountEmail: typeof data.email === 'string' ? data.email : null,
    metadata: data
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing GitHub access token.');
  const account = await resolveAccount(accessToken);
  const reposResponse = await fetch('https://api.github.com/user/repos?per_page=5', { headers: headers(accessToken) });
  const repoData = (await reposResponse.json()) as Record<string, unknown>;
  if (!reposResponse.ok) {
    throw new Error(String((repoData as Record<string, string>).message ?? 'GitHub sync failed.'));
  }

  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: { ...account.metadata, repos: repoData } as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'github.search_repositories',
    title: 'Search GitHub repositories',
    description: 'Find repositories by query for delivery or security reviews.',
    requiredProviderScopes: ['repo'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        perPage: { type: 'number', default: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'github.read_issue',
    title: 'Read GitHub issue',
    description: 'Read an issue or pull request across an owner/repo pair.',
    requiredProviderScopes: ['repo'],
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        issueNumber: { type: 'number' }
      },
      required: ['owner', 'repo', 'issueNumber']
    }
  },
  {
    name: 'github.comment_on_pull_request',
    title: 'Comment on pull request',
    description: 'Post context-aware review comments on pull requests.',
    requiredProviderScopes: ['repo'],
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        pullNumber: { type: 'number' },
        body: { type: 'string' }
      },
      required: ['owner', 'repo', 'pullNumber', 'body']
    }
  }
];

const liveScopes = ['repo', 'read:user', 'read:org'];

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'github',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This GitHub connection was revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect GitHub before tooling resumes.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'github',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'GitHub requires reauthorization.',
      signals: [connection.reauth_required_reason ?? 'GitHub flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'github',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'GitHub is missing required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect GitHub to restore repository/issue workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'github',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'GitHub repository and issue tooling is healthy.',
    signals: ['OAuth grant active', 'Repository tools available'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const githubIntegration: IntegrationDefinition = {
  id: 'github',
  displayName: 'GitHub',
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
  refreshTokens({ refreshToken }) {
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
    if (!accessToken) throw new Error('Missing GitHub access token.');

    if (toolName === 'github.search_repositories') {
      const query = String(input.query ?? '').trim();
      const perPage = String(Number(input.perPage ?? 10) || 10);
      const response = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${perPage}`, {
        headers: headers(accessToken)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(String((data as Record<string, string>).message ?? 'GitHub repository search failed.'));
      }
      return data;
    }

    if (toolName === 'github.read_issue') {
      const owner = String(input.owner ?? '').trim();
      const repo = String(input.repo ?? '').trim();
      const issueNumber = Number(input.issueNumber ?? 0);
      if (!owner || !repo || !issueNumber) {
        throw new Error('owner, repo, and issueNumber are required for issue reads.');
      }
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`, {
        headers: headers(accessToken)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(String((data as Record<string, string>).message ?? 'GitHub issue read failed.'));
      }
      return data;
    }

    if (toolName === 'github.comment_on_pull_request') {
      const owner = String(input.owner ?? '').trim();
      const repo = String(input.repo ?? '').trim();
      const pullNumber = Number(input.pullNumber ?? 0);
      const body = String(input.body ?? '');
      if (!owner || !repo || !pullNumber || !body) {
        throw new Error('owner, repo, pullNumber, and body are required for PR comments.');
      }
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/comments`,
        {
          method: 'POST',
          headers: headers(accessToken),
          body: JSON.stringify({ body })
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(String((data as Record<string, string>).message ?? 'GitHub pull request comment failed.'));
      }
      return data;
    }

    throw new Error(`Unknown GitHub tool: ${toolName}`);
  }
};
