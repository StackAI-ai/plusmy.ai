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
  authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2',
  tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  defaultScopes: ['com.intuit.quickbooks.accounting']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.QUICKBOOKS_CLIENT_ID || !env.QUICKBOOKS_CLIENT_SECRET) {
    throw new Error('QuickBooks OAuth credentials are missing.');
  }
  return { clientId: env.QUICKBOOKS_CLIENT_ID, clientSecret: env.QUICKBOOKS_CLIENT_SECRET };
}

function authHeader() {
  const { clientId, clientSecret } = getCredentials();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getRealmId(value: unknown) {
  const record = getRecord(value);
  const realmId = record?.realmId ?? record?.realm_id;
  return typeof realmId === 'string' && realmId.length > 0 ? realmId : null;
}

function quickBooksApiRoot(realmId: string) {
  return `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}`;
}

function parseQuickBooksError(data: unknown, fallback: string) {
  const record = getRecord(data);
  const fault = getRecord(record?.Fault);
  const errors = Array.isArray(fault?.Error) ? fault?.Error : [];
  const firstError = getRecord(errors[0]);
  const message = firstError?.Detail ?? firstError?.Message ?? record?.error_description ?? record?.error;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

async function exchangeToken(body: URLSearchParams, realmId?: string | null) {
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(parseQuickBooksError(data, 'QuickBooks token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: oauth.defaultScopes.slice(),
    raw: {
      ...(data as Record<string, Json>),
      ...(realmId ? ({ realmId } satisfies Record<string, Json>) : {})
    } as Json
  } satisfies ProviderTokenSet;
}

async function exchange(code: string, redirectUri: string, tokenSetMetadata?: Record<string, string>) {
  return exchangeToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }),
    tokenSetMetadata?.realmId ?? null
  );
}

async function refreshTokens(refreshToken: string, metadata?: Record<string, Json> | null) {
  return exchangeToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }),
    getRealmId(metadata) ?? null
  );
}

async function resolveAccount(accessToken: string, raw: Json): Promise<ResolvedProviderAccount> {
  const realmId = getRealmId(raw);
  if (!realmId) {
    throw new Error('QuickBooks callback is missing realmId metadata.');
  }

  const response = await fetch(`${quickBooksApiRoot(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=75`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(parseQuickBooksError(data, 'QuickBooks account resolve failed.'));
  }

  const companyInfo = getRecord(getRecord(data)?.CompanyInfo);
  return {
    externalAccountId: realmId,
    displayName: typeof companyInfo?.CompanyName === 'string' ? companyInfo.CompanyName : 'QuickBooks company',
    externalAccountEmail: null,
    metadata: {
      realmId,
      companyInfo: companyInfo ?? {},
      raw: getRecord(data) ?? {}
    }
  };
}

async function syncConnection({ credentials, connection }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing QuickBooks access token.');

  const account = await resolveAccount(accessToken, connection.metadata);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'quickbooks.search_customers',
    title: 'Search QuickBooks customers',
    description: 'Find QuickBooks customers by display name.',
    requiredProviderScopes: ['com.intuit.quickbooks.accounting'],
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
    name: 'quickbooks.read_invoices',
    title: 'Read QuickBooks invoices',
    description: 'Read invoices for a customer from QuickBooks Online.',
    requiredProviderScopes: ['com.intuit.quickbooks.accounting'],
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        limit: { type: 'number', default: 25 }
      },
      required: ['customerId']
    }
  }
];

const liveScopes = oauth.defaultScopes.slice();

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'quickbooks',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This QuickBooks connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect QuickBooks before finance workflows resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'quickbooks',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'QuickBooks needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'QuickBooks flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'quickbooks',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'QuickBooks is missing one or more required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect QuickBooks to restore customer and invoice workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (!getRealmId(connection.metadata)) {
    return {
      provider: 'quickbooks',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'QuickBooks is missing the company realm identifier.',
      signals: ['Reconnect QuickBooks so the company realmId is captured during OAuth callback.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'quickbooks',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'QuickBooks customer and invoice workflows are healthy.',
    signals: ['OAuth grant active', 'Company realm metadata present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

function escapeQuickBooksValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function queryQuickBooks(accessToken: string, realmId: string, query: string) {
  const response = await fetch(`${quickBooksApiRoot(realmId)}/query?query=${encodeURIComponent(query)}&minorversion=75`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(parseQuickBooksError(data, 'QuickBooks query failed.'));
  }
  return data;
}

export const quickbooksIntegration: IntegrationDefinition = {
  id: 'quickbooks',
  displayName: 'QuickBooks Online',
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
  exchangeAuthorizationCode({ code, redirectUri, providerConfig }: AuthorizationCodeInput) {
    return exchange(code, redirectUri, providerConfig);
  },
  refreshTokens({ refreshToken, metadata }) {
    return refreshTokens(refreshToken, metadata);
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveAccount(String(tokenSet.accessToken ?? ''), tokenSet.raw);
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
    if (!accessToken) throw new Error('Missing QuickBooks access token.');

    const realmId = getRealmId(context.connection.metadata);
    if (!realmId) throw new Error('QuickBooks connection metadata is missing realmId.');

    if (toolName === 'quickbooks.search_customers') {
      const query = String(input.query ?? '').trim();
      const limit = Number(input.limit ?? 25);
      if (!query) throw new Error('query is required.');

      const statement = `select * from Customer where DisplayName like '%${escapeQuickBooksValue(query)}%' startposition 1 maxresults ${Number.isFinite(limit) ? limit : 25}`;
      const data = await queryQuickBooks(accessToken, realmId, statement);
      const customers = Array.isArray(getRecord(data)?.QueryResponse && getRecord(getRecord(data)?.QueryResponse)?.Customer)
        ? (getRecord(getRecord(data)?.QueryResponse)?.Customer as unknown[])
        : [];
      return {
        query,
        totalFound: customers.length,
        customers
      };
    }

    if (toolName === 'quickbooks.read_invoices') {
      const customerId = String(input.customerId ?? '').trim();
      const limit = Number(input.limit ?? 25);
      if (!customerId) throw new Error('customerId is required.');

      const statement = `select * from Invoice where CustomerRef = '${escapeQuickBooksValue(customerId)}' startposition 1 maxresults ${Number.isFinite(limit) ? limit : 25}`;
      const data = await queryQuickBooks(accessToken, realmId, statement);
      const invoices = Array.isArray(getRecord(data)?.QueryResponse && getRecord(getRecord(data)?.QueryResponse)?.Invoice)
        ? (getRecord(getRecord(data)?.QueryResponse)?.Invoice as unknown[])
        : [];
      return {
        customerId,
        totalFound: invoices.length,
        invoices
      };
    }

    throw new Error(`Unknown QuickBooks tool: ${toolName}`);
  }
};
