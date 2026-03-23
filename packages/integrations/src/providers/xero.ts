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
  authorizationUrl: 'https://login.xero.com/identity/connect/authorize',
  tokenUrl: 'https://identity.xero.com/connect/token',
  defaultScopes: ['offline_access', 'accounting.contacts', 'accounting.transactions']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
    throw new Error('Xero OAuth credentials are missing.');
  }
  return { clientId: env.XERO_CLIENT_ID, clientSecret: env.XERO_CLIENT_SECRET };
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseXeroError(data: unknown, fallback: string) {
  const record = getRecord(data);
  const message = record?.Message ?? record?.message ?? record?.error_description ?? record?.error;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function getTenantId(value: unknown) {
  const record = getRecord(value);
  const tenantId = record?.tenantId ?? record?.tenant_id;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null;
}

function authHeader() {
  const { clientId, clientSecret } = getCredentials();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

async function exchangeToken(body: URLSearchParams, tenantId?: string | null) {
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
    throw new Error(parseXeroError(data, 'Xero token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 1800);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: oauth.defaultScopes.slice(),
    raw: {
      ...(data as Record<string, Json>),
      ...(tenantId ? ({ tenantId } satisfies Record<string, Json>) : {})
    } as Json
  } satisfies ProviderTokenSet;
}

async function listConnections(accessToken: string) {
  const response = await fetch('https://api.xero.com/connections', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(parseXeroError(data, 'Failed to resolve Xero tenants.'));
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('No Xero tenants are available for this connection.');
  }
  return data;
}

async function resolveAccount(accessToken: string, raw: Json): Promise<ResolvedProviderAccount> {
  const connections = await listConnections(accessToken);
  const configuredTenantId = getTenantId(raw);
  const matchedTenant = connections.find((entry) => getRecord(entry)?.tenantId === configuredTenantId);
  const tenant = matchedTenant ?? connections[0];
  const tenantRecord = getRecord(tenant);
  const tenantId = typeof tenantRecord?.tenantId === 'string' ? tenantRecord.tenantId : configuredTenantId ?? 'xero-tenant';
  const tenantName = typeof tenantRecord?.tenantName === 'string' ? tenantRecord.tenantName : 'Xero organization';

  return {
    externalAccountId: tenantId,
    displayName: tenantName,
    externalAccountEmail: null,
    metadata: {
      tenantId,
      tenantName,
      tenants: connections
    }
  };
}

async function syncConnection({ credentials, connection }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Xero access token.');

  const account = await resolveAccount(accessToken, connection.metadata);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: null,
    metadata: account.metadata as Record<string, Json>
  };
}

function xeroHeaders(accessToken: string, tenantId: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Xero-tenant-id': tenantId
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'xero.search_contacts',
    title: 'Search Xero contacts',
    description: 'Find Xero contacts for finance and customer follow-up workflows.',
    requiredProviderScopes: ['accounting.contacts'],
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
    name: 'xero.read_invoices',
    title: 'Read Xero invoices',
    description: 'Read Xero invoices by status, optionally filtered to a contact.',
    requiredProviderScopes: ['accounting.transactions'],
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        contactId: { type: 'string' },
        limit: { type: 'number', default: 25 }
      },
      required: ['status']
    }
  }
];

const liveScopes = oauth.defaultScopes.slice();

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'xero',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Xero connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Xero before finance workflows resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'xero',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Xero needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Xero flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'xero',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Xero is missing one or more required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Xero to restore contact and invoice workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (!getTenantId(connection.metadata)) {
    return {
      provider: 'xero',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Xero tenant metadata is missing.',
      signals: ['Run a sync or reconnect Xero so the selected tenant is stored on the connection.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'xero',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Xero contact and invoice workflows are healthy.',
    signals: ['OAuth grant active', 'Tenant metadata present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const xeroIntegration: IntegrationDefinition = {
  id: 'xero',
  displayName: 'Xero',
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
    return exchangeToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    );
  },
  refreshTokens({ refreshToken, metadata }) {
    return exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      getTenantId(metadata) ?? null
    );
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
    if (!accessToken) throw new Error('Missing Xero access token.');

    const tenantId = getTenantId(context.connection.metadata);
    if (!tenantId) throw new Error('Xero connection metadata is missing tenantId.');

    if (toolName === 'xero.search_contacts') {
      const query = String(input.query ?? '').trim();
      const limit = Number(input.limit ?? 25);
      if (!query) throw new Error('query is required.');

      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/Contacts?searchTerm=${encodeURIComponent(query)}&page=1`,
        { headers: xeroHeaders(accessToken, tenantId) }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseXeroError(data, 'Xero contact search failed.'));
      }

      const contacts = Array.isArray(getRecord(data)?.Contacts) ? ((getRecord(data)?.Contacts as unknown[]).slice(0, Number.isFinite(limit) ? limit : 25)) : [];
      return {
        query,
        totalFound: contacts.length,
        contacts
      };
    }

    if (toolName === 'xero.read_invoices') {
      const status = String(input.status ?? '').trim();
      const contactId = String(input.contactId ?? '').trim();
      if (!status) throw new Error('status is required.');

      const clauses = [`Status=="${status.replace(/"/g, '\\"')}"`];
      if (contactId) {
        clauses.push(`Contact.ContactID==Guid("${contactId.replace(/"/g, '\\"')}")`);
      }

      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(clauses.join('&&'))}`,
        { headers: xeroHeaders(accessToken, tenantId) }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseXeroError(data, 'Xero invoice read failed.'));
      }

      const invoices = Array.isArray(getRecord(data)?.Invoices) ? (getRecord(data)?.Invoices as unknown[]) : [];
      return {
        status,
        contactId: contactId || null,
        totalFound: invoices.length,
        invoices
      };
    }

    throw new Error(`Unknown Xero tool: ${toolName}`);
  }
};
