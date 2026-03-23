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
  authorizationUrl: 'https://airtable.com/oauth2/v1/authorize',
  tokenUrl: 'https://airtable.com/oauth2/v1/token',
  defaultScopes: ['data.records:read', 'data.records:write', 'schema.bases:read', 'schema.bases:write']
};

type AirtableBase = {
  id: string;
  name: string;
  permissionLevel?: string;
};

type AirtableCreateRecord = {
  fields: Record<string, Json>;
};

type AirtableUpdateRecord = {
  id: string;
  fields: Record<string, Json>;
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.AIRTABLE_CLIENT_ID || !env.AIRTABLE_CLIENT_SECRET) {
    throw new Error('Airtable OAuth credentials are missing.');
  }
  return { clientId: env.AIRTABLE_CLIENT_ID, clientSecret: env.AIRTABLE_CLIENT_SECRET };
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseScopes(value: unknown, fallback: string[]) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }
  return value
    .split(/[ ,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function parseAirtableError(data: unknown, fallback: string) {
  const record = getRecord(data);
  const errorRecord = getRecord(record?.error);
  const message =
    errorRecord?.message ??
    errorRecord?.type ??
    record?.error_description ??
    record?.error ??
    record?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function headers(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getFieldIdList(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function getCreateRecords(value: unknown): AirtableCreateRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('records must be a non-empty array.');
  }
  if (value.length > 10) {
    throw new Error('Airtable record writes are limited to 10 records per request.');
  }
  return value.map((entry) => {
    const record = getRecord(entry);
    if (!record || !isJsonRecord(record.fields)) {
      throw new Error('Each record must include a fields object.');
    }
    return { fields: record.fields };
  });
}

function getUpdateRecords(value: unknown): AirtableUpdateRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('records must be a non-empty array.');
  }
  if (value.length > 10) {
    throw new Error('Airtable record writes are limited to 10 records per request.');
  }
  return value.map((entry) => {
    const record = getRecord(entry);
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    if (!id || !record || !isJsonRecord(record.fields)) {
      throw new Error('Each record must include an id and fields object.');
    }
    return { id, fields: record.fields };
  });
}

function airtableTableUrl(baseId: string, tableIdOrName: string) {
  return `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableIdOrName)}`;
}

async function exchangeToken(body: URLSearchParams) {
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...Object.fromEntries(body.entries())
    })
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(parseAirtableError(data, 'Airtable token exchange failed.'));
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

async function listBases(accessToken: string): Promise<AirtableBase[]> {
  const response = await fetch('https://api.airtable.com/v0/meta/bases', { headers: headers(accessToken) });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(parseAirtableError(data, 'Airtable base list failed.'));
  }

  const bases = Array.isArray(getRecord(data)?.bases) ? (getRecord(data)?.bases as unknown[]) : [];
  const results: AirtableBase[] = [];
  for (const entry of bases) {
    const record = getRecord(entry);
    const id = typeof record?.id === 'string' ? record.id : '';
    const name = typeof record?.name === 'string' ? record.name : '';
    const permissionLevel = typeof record?.permissionLevel === 'string' ? record.permissionLevel : undefined;
    if (!id || !name) {
      continue;
    }
    results.push({ id, name, permissionLevel });
  }
  return results;
}

async function listTables(accessToken: string, baseId: string) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`, {
    headers: headers(accessToken)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(parseAirtableError(data, 'Airtable table list failed.'));
  }
  return Array.isArray(getRecord(data)?.tables) ? ((getRecord(data)?.tables as unknown[]) as Json[]) : [];
}

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const bases = await listBases(accessToken);
  const primaryBase = bases[0];
  return {
    externalAccountId: primaryBase?.id ?? 'airtable-workspace',
    displayName: primaryBase?.name ?? 'Airtable workspace',
    externalAccountEmail: null,
    metadata: {
      baseCount: bases.length,
      basesPreview: bases.slice(0, 10)
    }
  };
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Airtable access token.');

  const account = await resolveAccount(accessToken);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: null,
    metadata: account.metadata as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'airtable.search_bases',
    title: 'Search Airtable bases',
    description: 'Find Airtable bases for workspace operations and system handoffs.',
    requiredProviderScopes: ['schema.bases:read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 25 }
      }
    }
  },
  {
    name: 'airtable.list_tables',
    title: 'List Airtable tables',
    description: 'List tables inside an Airtable base before inspecting or updating records.',
    requiredProviderScopes: ['schema.bases:read'],
    inputSchema: {
      type: 'object',
      properties: {
        baseId: { type: 'string' }
      },
      required: ['baseId']
    }
  },
  {
    name: 'airtable.list_records',
    title: 'List Airtable records',
    description: 'Read records from a chosen Airtable table.',
    requiredProviderScopes: ['data.records:read'],
    inputSchema: {
      type: 'object',
      properties: {
        baseId: { type: 'string' },
        tableIdOrName: { type: 'string' },
        limit: { type: 'number', default: 25 },
        fieldIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['baseId', 'tableIdOrName']
    }
  },
  {
    name: 'airtable.create_records',
    title: 'Create Airtable records',
    description: 'Create new Airtable records in a governed operator workflow.',
    requiredProviderScopes: ['data.records:write'],
    inputSchema: {
      type: 'object',
      properties: {
        baseId: { type: 'string' },
        tableIdOrName: { type: 'string' },
        typecast: { type: 'boolean', default: true },
        records: { type: 'array' }
      },
      required: ['baseId', 'tableIdOrName', 'records']
    }
  },
  {
    name: 'airtable.update_records',
    title: 'Update Airtable records',
    description: 'Update Airtable records by id while preserving other fields.',
    requiredProviderScopes: ['data.records:write'],
    inputSchema: {
      type: 'object',
      properties: {
        baseId: { type: 'string' },
        tableIdOrName: { type: 'string' },
        typecast: { type: 'boolean', default: true },
        records: { type: 'array' }
      },
      required: ['baseId', 'tableIdOrName', 'records']
    }
  }
];

const liveScopes = oauth.defaultScopes.slice();

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'airtable',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Airtable connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Airtable before operational-table workflows resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'airtable',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Airtable needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Airtable flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'airtable',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Airtable is missing one or more required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Airtable to restore base, table, and record workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'airtable',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Airtable base, table, and record workflows are healthy.',
    signals: ['OAuth grant active', 'Base schema and record scopes present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const airtableIntegration: IntegrationDefinition = {
  id: 'airtable',
  displayName: 'Airtable',
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
  refreshTokens({ refreshToken }) {
    return exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    );
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
    if (!accessToken) throw new Error('Missing Airtable access token.');

    if (toolName === 'airtable.search_bases') {
      const query = String(input.query ?? '').trim().toLowerCase();
      const limit = Number(input.limit ?? 25);
      const bases = await listBases(accessToken);
      const filtered = query.length > 0
        ? bases.filter((base) => base.name.toLowerCase().includes(query) || base.id.toLowerCase().includes(query))
        : bases;
      return {
        query: query || null,
        totalFound: filtered.length,
        bases: filtered.slice(0, Number.isFinite(limit) ? limit : 25)
      };
    }

    if (toolName === 'airtable.list_tables') {
      const baseId = String(input.baseId ?? '').trim();
      if (!baseId) throw new Error('baseId is required.');
      const tables = await listTables(accessToken, baseId);
      return {
        baseId,
        totalFound: tables.length,
        tables
      };
    }

    if (toolName === 'airtable.list_records') {
      const baseId = String(input.baseId ?? '').trim();
      const tableIdOrName = String(input.tableIdOrName ?? '').trim();
      const limit = Number(input.limit ?? 25);
      if (!baseId || !tableIdOrName) {
        throw new Error('baseId and tableIdOrName are required.');
      }

      const url = new URL(airtableTableUrl(baseId, tableIdOrName));
      url.searchParams.set('pageSize', String(Number.isFinite(limit) ? limit : 25));
      for (const fieldId of getFieldIdList(input.fieldIds)) {
        url.searchParams.append('fields[]', fieldId);
      }

      const response = await fetch(url, { headers: headers(accessToken) });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseAirtableError(data, 'Airtable record list failed.'));
      }

      const records = Array.isArray(getRecord(data)?.records) ? ((getRecord(data)?.records as unknown[]) as Json[]) : [];
      return {
        baseId,
        tableIdOrName,
        totalFound: records.length,
        records,
        offset: typeof getRecord(data)?.offset === 'string' ? getRecord(data)?.offset : null
      };
    }

    if (toolName === 'airtable.create_records') {
      const baseId = String(input.baseId ?? '').trim();
      const tableIdOrName = String(input.tableIdOrName ?? '').trim();
      const typecast = input.typecast !== false;
      if (!baseId || !tableIdOrName) {
        throw new Error('baseId and tableIdOrName are required.');
      }

      const records = getCreateRecords(input.records);
      const response = await fetch(airtableTableUrl(baseId, tableIdOrName), {
        method: 'POST',
        headers: headers(accessToken),
        body: JSON.stringify({ records, typecast })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseAirtableError(data, 'Airtable record create failed.'));
      }

      return {
        baseId,
        tableIdOrName,
        createdCount: Array.isArray(getRecord(data)?.records) ? (getRecord(data)?.records as unknown[]).length : 0,
        records: Array.isArray(getRecord(data)?.records) ? ((getRecord(data)?.records as unknown[]) as Json[]) : []
      };
    }

    if (toolName === 'airtable.update_records') {
      const baseId = String(input.baseId ?? '').trim();
      const tableIdOrName = String(input.tableIdOrName ?? '').trim();
      const typecast = input.typecast !== false;
      if (!baseId || !tableIdOrName) {
        throw new Error('baseId and tableIdOrName are required.');
      }

      const records = getUpdateRecords(input.records);
      const response = await fetch(airtableTableUrl(baseId, tableIdOrName), {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ records, typecast })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseAirtableError(data, 'Airtable record update failed.'));
      }

      return {
        baseId,
        tableIdOrName,
        updatedCount: Array.isArray(getRecord(data)?.records) ? (getRecord(data)?.records as unknown[]).length : 0,
        records: Array.isArray(getRecord(data)?.records) ? ((getRecord(data)?.records as unknown[]) as Json[]) : []
      };
    }

    throw new Error(`Unknown Airtable tool: ${toolName}`);
  }
};
