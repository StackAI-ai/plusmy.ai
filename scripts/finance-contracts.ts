import assert from 'node:assert/strict';

function seedEnv() {
  Object.assign(process.env, {
    APP_URL: process.env.APP_URL ?? 'http://localhost:3009',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'service-role-key',
    MCP_JWT_SECRET: process.env.MCP_JWT_SECRET ?? 'mcp-jwt-secret-mcp-jwt-secret-mcp-jwt-secret',
    WORKER_SHARED_SECRET: process.env.WORKER_SHARED_SECRET ?? 'worker-shared-secret-worker-shared-secret',
    QUICKBOOKS_CLIENT_ID: process.env.QUICKBOOKS_CLIENT_ID ?? 'quickbooks-client-id',
    QUICKBOOKS_CLIENT_SECRET: process.env.QUICKBOOKS_CLIENT_SECRET ?? 'quickbooks-client-secret',
    XERO_CLIENT_ID: process.env.XERO_CLIENT_ID ?? 'xero-client-id',
    XERO_CLIENT_SECRET: process.env.XERO_CLIENT_SECRET ?? 'xero-client-secret',
    AIRTABLE_CLIENT_ID: process.env.AIRTABLE_CLIENT_ID ?? 'airtable-client-id',
    AIRTABLE_CLIENT_SECRET: process.env.AIRTABLE_CLIENT_SECRET ?? 'airtable-client-secret',
    ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID ?? 'zoom-client-id',
    ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET ?? 'zoom-client-secret'
  });
}

seedEnv();

let getIntegration: typeof import('../packages/integrations/src/registry.ts')['getIntegration'];

type FetchHandler = (request: Request) => Promise<Response> | Response;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function withMockedFetch(handler: FetchHandler, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return await handler(request);
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readFormBody(request: Request) {
  return request.text().then((text) => new URLSearchParams(text));
}

function buildConnection(overrides: Record<string, unknown>) {
  return {
    id: 'connection-1',
    workspace_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    owner_user_id: null,
    connection_key: 'connection-key',
    provider: 'quickbooks',
    scope: 'workspace',
    status: 'active',
    display_name: 'Finance connection',
    external_account_id: null,
    external_account_email: null,
    granted_scopes: [],
    expires_at: null,
    last_refreshed_at: null,
    last_validated_at: null,
    reauth_required_reason: null,
    metadata: {},
    ...overrides
  };
}

async function testQuickBooks() {
  const integration = getIntegration('quickbooks');
  assert.ok(integration, 'QuickBooks integration is missing from the registry');

  const redirectUri = 'https://app.example.test/callback';
  const authorizationUrl = new URL(
    integration.buildAuthorizationUrl({
      redirectUri,
      state: 'state-123',
      scopes: ['com.intuit.quickbooks.accounting']
    })
  );

  assert.equal(authorizationUrl.origin + authorizationUrl.pathname, 'https://appcenter.intuit.com/connect/oauth2');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'quickbooks-client-id');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-123');

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);
    if (url.origin === 'https://oauth.platform.intuit.com') {
      assert.equal(request.method, 'POST');
      const form = await readFormBody(request);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'qb-code');
      assert.equal(form.get('redirect_uri'), redirectUri);
      return jsonResponse({
        access_token: 'qb-access',
        refresh_token: 'qb-refresh',
        token_type: 'Bearer',
        expires_in: 3600
      });
    }

    assert.equal(url.origin, 'https://quickbooks.api.intuit.com');
    assert.equal(url.pathname, '/v3/company/1234567890/companyinfo/1234567890');
    assert.equal(url.searchParams.get('minorversion'), '75');
    return jsonResponse({
      CompanyInfo: {
        CompanyName: 'Acme Books'
      }
    });
  }, async () => {
    const tokenSet = await integration.exchangeAuthorizationCode({ code: 'qb-code', redirectUri });
    assert.equal(tokenSet.accessToken, 'qb-access');
    assert.equal(tokenSet.refreshToken, 'qb-refresh');
    assert.ok(tokenSet.expiresAt, 'QuickBooks token set is missing expiresAt');

    const callbackTokenSet = {
      ...tokenSet,
      raw: { ...(tokenSet.raw as Record<string, unknown>), realmId: '1234567890' }
    };

    const account = await integration.resolveAccount(callbackTokenSet);
    assert.equal(account.externalAccountId, '1234567890');
    assert.equal(account.displayName, 'Acme Books');
    assert.equal((account.metadata as Record<string, unknown>).realmId, '1234567890');

    const synced = await integration.syncJobs?.[0]?.run({
      connection: buildConnection({ provider: 'quickbooks', metadata: { realmId: '1234567890' } }),
      credentials: { accessToken: 'qb-access', refreshToken: 'qb-refresh', tokenType: 'Bearer', expiresAt: null },
      payload: {}
    });
    assert.equal(synced?.displayName, 'Acme Books');
    assert.equal(synced?.externalAccountId, '1234567890');
  });

  const qbConnection = buildConnection({
    provider: 'quickbooks',
    display_name: 'QuickBooks Acme',
    granted_scopes: ['com.intuit.quickbooks.accounting'],
    metadata: { realmId: '1234567890' },
    last_validated_at: '2026-03-23T00:00:00.000Z'
  });

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://quickbooks.api.intuit.com');
    assert.equal(url.pathname, '/v3/company/1234567890/query');
    const query = url.searchParams.get('query') ?? '';
    if (query.includes('Invoice')) {
      return jsonResponse({
        QueryResponse: {
          Invoice: [{ Id: '88', DocNumber: 'INV-88' }]
        }
      });
    }

    if (query.includes('Customer')) {
      return jsonResponse({
        QueryResponse: {
          Customer: [{ Id: '42', DisplayName: 'Acme Consulting' }]
        }
      });
    }

    throw new Error(`Unexpected QuickBooks query: ${query}`);
  }, async () => {
    const customers = await integration.callTool(
      'quickbooks.search_customers',
      { query: 'Acme', limit: 10 },
      {
        connection: qbConnection,
        credentials: { accessToken: 'qb-access', refreshToken: 'qb-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((customers as Record<string, unknown>).totalFound, 1);

    const invoices = await integration.callTool(
      'quickbooks.read_invoices',
      { customerId: '42', limit: 10 },
      {
        connection: qbConnection,
        credentials: { accessToken: 'qb-access', refreshToken: 'qb-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((invoices as Record<string, unknown>).totalFound, 1);
  });

  const healthy = await integration.health(qbConnection);
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.provider, 'quickbooks');
  assert.equal(integration.health(buildConnection({ provider: 'quickbooks', granted_scopes: [] })).status, 'attention');
  assert.equal(integration.health(buildConnection({ provider: 'quickbooks', status: 'reauth_required' })).status, 'reauth_required');
  assert.equal(integration.health(buildConnection({ provider: 'quickbooks', status: 'revoked' })).status, 'revoked');
}

async function testXero() {
  const integration = getIntegration('xero');
  assert.ok(integration, 'Xero integration is missing from the registry');

  const redirectUri = 'https://app.example.test/callback';
  const authorizationUrl = new URL(
    integration.buildAuthorizationUrl({
      redirectUri,
      state: 'state-456',
      scopes: ['offline_access', 'accounting.contacts']
    })
  );

  assert.equal(authorizationUrl.origin + authorizationUrl.pathname, 'https://login.xero.com/identity/connect/authorize');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'xero-client-id');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'offline_access accounting.contacts');
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-456');

  await withMockedFetch(async (request) => {
    assert.equal(request.url, 'https://identity.xero.com/connect/token');
    assert.equal(request.method, 'POST');
    const form = await readFormBody(request);
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      assert.equal(form.get('code'), 'xero-code');
      assert.equal(form.get('redirect_uri'), redirectUri);
      return jsonResponse({
        access_token: 'xero-access',
        refresh_token: 'xero-refresh',
        token_type: 'Bearer',
        expires_in: 1800
      });
    }

    if (grantType === 'refresh_token') {
      assert.equal(form.get('refresh_token'), 'xero-refresh');
      return jsonResponse({
        access_token: 'xero-refreshed-access',
        refresh_token: 'xero-refresh',
        token_type: 'Bearer',
        expires_in: 1800
      });
    }

    throw new Error(`Unexpected Xero grant_type: ${grantType}`);
  }, async () => {
    const tokenSet = await integration.exchangeAuthorizationCode({ code: 'xero-code', redirectUri });
    assert.equal(tokenSet.accessToken, 'xero-access');
    assert.equal(tokenSet.refreshToken, 'xero-refresh');

    const refreshed = await integration.refreshTokens({
      refreshToken: 'xero-refresh',
      metadata: { tenantId: 'tenant-2' }
    });
    assert.equal(refreshed.accessToken, 'xero-refreshed-access');
    assert.equal(refreshed.refreshToken, 'xero-refresh');
    assert.equal((refreshed.raw as Record<string, unknown>).tenantId, 'tenant-2');
  });

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.xero.com');
    assert.equal(url.pathname, '/connections');
    return jsonResponse([
      { tenantId: 'tenant-1', tenantName: 'First tenant' },
      { tenantId: 'tenant-2', tenantName: 'Acme Finance' }
    ]);
  }, async () => {
    const account = await integration.resolveAccount({
      accessToken: 'xero-access',
      raw: { tenantId: 'tenant-2' }
    });
    assert.equal(account.externalAccountId, 'tenant-2');
    assert.equal(account.displayName, 'Acme Finance');
    assert.equal((account.metadata as Record<string, unknown>).tenantId, 'tenant-2');
  });

  const xeroConnection = buildConnection({
    provider: 'xero',
    display_name: 'Xero Acme',
    granted_scopes: ['offline_access', 'accounting.contacts', 'accounting.transactions'],
    metadata: { tenantId: 'tenant-2', tenantName: 'Acme Finance' },
    last_validated_at: '2026-03-23T00:00:00.000Z'
  });

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.xero.com');

    if (url.pathname.includes('/Contacts')) {
      return jsonResponse({
        Contacts: [{ ContactID: 'contact-1', Name: 'Acme Contact' }]
      });
    }

    if (url.pathname.includes('/Invoices')) {
      return jsonResponse({
        Invoices: [{ InvoiceID: 'invoice-1', Status: 'AUTHORISED' }]
      });
    }

    throw new Error(`Unexpected Xero request: ${request.url}`);
  }, async () => {
    const contacts = await integration.callTool(
      'xero.search_contacts',
      { query: 'Acme', limit: 5 },
      {
        connection: xeroConnection,
        credentials: { accessToken: 'xero-access', refreshToken: 'xero-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((contacts as Record<string, unknown>).totalFound, 1);

    const invoices = await integration.callTool(
      'xero.read_invoices',
      { status: 'AUTHORISED', contactId: 'contact-1', limit: 5 },
      {
        connection: xeroConnection,
        credentials: { accessToken: 'xero-access', refreshToken: 'xero-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((invoices as Record<string, unknown>).totalFound, 1);
  });

  const healthy = integration.health(xeroConnection);
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.provider, 'xero');
  assert.equal(integration.health(buildConnection({ provider: 'xero', granted_scopes: [] })).status, 'attention');
  assert.equal(integration.health(buildConnection({ provider: 'xero', status: 'reauth_required' })).status, 'reauth_required');
  assert.equal(integration.health(buildConnection({ provider: 'xero', status: 'revoked' })).status, 'revoked');
}

async function testAirtable() {
  const integration = getIntegration('airtable');
  assert.ok(integration, 'Airtable integration is missing from the registry');

  const redirectUri = 'https://app.example.test/callback';
  const authorizationUrl = new URL(
    integration.buildAuthorizationUrl({
      redirectUri,
      state: 'state-789',
      scopes: ['data.records:read', 'data.records:write']
    })
  );

  assert.equal(authorizationUrl.origin + authorizationUrl.pathname, 'https://airtable.com/oauth2/v1/authorize');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'airtable-client-id');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'data.records:read data.records:write');
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-789');

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);
    if (url.origin === 'https://airtable.com') {
      assert.equal(request.method, 'POST');
      const form = await readFormBody(request);
      const grantType = form.get('grant_type');
      if (grantType === 'authorization_code') {
        assert.equal(form.get('code'), 'airtable-code');
        assert.equal(form.get('redirect_uri'), redirectUri);
        return jsonResponse({
          access_token: 'airtable-access',
          refresh_token: 'airtable-refresh',
          token_type: 'Bearer',
          scope: 'data.records:read data.records:write',
          expires_in: 3600
        });
      }

      if (grantType === 'refresh_token') {
        assert.equal(form.get('refresh_token'), 'airtable-refresh');
        return jsonResponse({
          access_token: 'airtable-refreshed-access',
          refresh_token: 'airtable-refresh',
          token_type: 'Bearer',
          scope: 'data.records:read data.records:write',
          expires_in: 3600
        });
      }

      throw new Error(`Unexpected Airtable grant_type: ${grantType}`);
    }

    assert.equal(url.origin, 'https://api.airtable.com');
    if (url.pathname === '/v0/meta/bases') {
      return jsonResponse({
        bases: [
          { id: 'base-1', name: 'Acme Operations', permissionLevel: 'create' },
          { id: 'base-2', name: 'Unrelated Base', permissionLevel: 'read' }
        ]
      });
    }

    if (url.pathname === '/v0/meta/bases/base-1/tables') {
      return jsonResponse({
        tables: [
          { id: 'tbl-1', name: 'Contacts' },
          { id: 'tbl-2', name: 'Projects' }
        ]
      });
    }

    if (url.pathname === '/v0/base-1/Contacts' && request.method === 'GET') {
      assert.equal(url.searchParams.get('pageSize'), '5');
      assert.equal(url.searchParams.getAll('fields[]').join(','), 'Name,Email');
      return jsonResponse({
        records: [{ id: 'rec-1', fields: { Name: 'Alice', Email: 'alice@example.com' } }],
        offset: 'offset-1'
      });
    }

    if (url.pathname === '/v0/base-1/Contacts' && request.method === 'POST') {
      const body = JSON.parse(await request.text()) as { records?: unknown[]; typecast?: boolean };
      assert.equal(body.typecast, true);
      assert.equal(Array.isArray(body.records), true);
      assert.equal(body.records?.length ?? 0, 1);
      return jsonResponse({
        records: [{ id: 'rec-created', fields: { Name: 'Bob' } }]
      });
    }

    if (url.pathname === '/v0/base-1/Contacts' && request.method === 'PATCH') {
      const body = JSON.parse(await request.text()) as { records?: Array<{ id?: string }> };
      assert.equal(body.records?.[0]?.id, 'rec-created');
      return jsonResponse({
        records: [{ id: 'rec-created', fields: { Name: 'Bob Updated' } }]
      });
    }

    throw new Error(`Unexpected Airtable request: ${request.method} ${request.url}`);
  }, async () => {
    const tokenSet = await integration.exchangeAuthorizationCode({ code: 'airtable-code', redirectUri });
    assert.equal(tokenSet.accessToken, 'airtable-access');
    assert.equal(tokenSet.refreshToken, 'airtable-refresh');
    assert.ok(tokenSet.expiresAt, 'Airtable token set is missing expiresAt');
    assert.deepEqual(tokenSet.scopes, ['data.records:read', 'data.records:write']);

    const refreshed = await integration.refreshTokens({ refreshToken: 'airtable-refresh' });
    assert.equal(refreshed.accessToken, 'airtable-refreshed-access');
    assert.equal(refreshed.refreshToken, 'airtable-refresh');

    const account = await integration.resolveAccount(tokenSet);
    assert.equal(account.externalAccountId, 'base-1');
    assert.equal(account.displayName, 'Acme Operations');
    assert.equal((account.metadata as Record<string, unknown>).baseCount, 2);

    const synced = await integration.syncJobs?.[0]?.run({
      connection: buildConnection({ provider: 'airtable', metadata: {} }),
      credentials: { accessToken: 'airtable-access', refreshToken: 'airtable-refresh', tokenType: 'Bearer', expiresAt: null },
      payload: {}
    });
    assert.equal(synced?.displayName, 'Acme Operations');
    assert.equal(synced?.externalAccountId, 'base-1');

    const baseResults = await integration.callTool(
      'airtable.search_bases',
      { query: 'Acme', limit: 10 },
      {
        connection: buildConnection({ provider: 'airtable', granted_scopes: ['data.records:read', 'data.records:write'] }),
        credentials: { accessToken: 'airtable-access', refreshToken: 'airtable-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((baseResults as Record<string, unknown>).totalFound, 1);

    const tables = await integration.callTool(
      'airtable.list_tables',
      { baseId: 'base-1' },
      {
        connection: buildConnection({ provider: 'airtable', granted_scopes: ['schema.bases:read'] }),
        credentials: { accessToken: 'airtable-access', refreshToken: 'airtable-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((tables as Record<string, unknown>).totalFound, 2);

    const records = await integration.callTool(
      'airtable.list_records',
      { baseId: 'base-1', tableIdOrName: 'Contacts', limit: 5, fieldIds: ['Name', 'Email'] },
      {
        connection: buildConnection({ provider: 'airtable', granted_scopes: ['data.records:read'] }),
        credentials: { accessToken: 'airtable-access', refreshToken: 'airtable-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((records as Record<string, unknown>).totalFound, 1);

    const created = await integration.callTool(
      'airtable.create_records',
      {
        baseId: 'base-1',
        tableIdOrName: 'Contacts',
        records: [{ fields: { Name: 'Bob' } }]
      },
      {
        connection: buildConnection({ provider: 'airtable', granted_scopes: ['data.records:write'] }),
        credentials: { accessToken: 'airtable-access', refreshToken: 'airtable-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((created as Record<string, unknown>).createdCount, 1);

    const updated = await integration.callTool(
      'airtable.update_records',
      {
        baseId: 'base-1',
        tableIdOrName: 'Contacts',
        records: [{ id: 'rec-created', fields: { Name: 'Bob Updated' } }]
      },
      {
        connection: buildConnection({ provider: 'airtable', granted_scopes: ['data.records:write'] }),
        credentials: { accessToken: 'airtable-access', refreshToken: 'airtable-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((updated as Record<string, unknown>).updatedCount, 1);
  });

  const healthy = integration.health(buildConnection({
    provider: 'airtable',
    display_name: 'Airtable Acme',
    granted_scopes: ['data.records:read', 'data.records:write', 'schema.bases:read', 'schema.bases:write'],
    last_validated_at: '2026-03-23T00:00:00.000Z'
  }));
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.provider, 'airtable');
  assert.equal(integration.health(buildConnection({ provider: 'airtable', granted_scopes: [] })).status, 'attention');
  assert.equal(integration.health(buildConnection({ provider: 'airtable', status: 'reauth_required' })).status, 'reauth_required');
  assert.equal(integration.health(buildConnection({ provider: 'airtable', status: 'revoked' })).status, 'revoked');
}

async function testZoom() {
  const integration = getIntegration('zoom');
  assert.ok(integration, 'Zoom integration is missing from the registry');

  const redirectUri = 'https://app.example.test/callback';
  const authorizationUrl = new URL(
    integration.buildAuthorizationUrl({
      redirectUri,
      state: 'state-abc',
      scopes: ['user:read', 'meeting:read']
    })
  );

  assert.equal(authorizationUrl.origin + authorizationUrl.pathname, 'https://zoom.us/oauth/authorize');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'zoom-client-id');
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'user:read meeting:read');
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-abc');

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);
    if (url.origin === 'https://zoom.us') {
      assert.equal(request.method, 'POST');
      const form = await readFormBody(request);
      const grantType = form.get('grant_type');
      if (grantType === 'authorization_code') {
        assert.equal(form.get('code'), 'zoom-code');
        assert.equal(form.get('redirect_uri'), redirectUri);
        return jsonResponse({
          access_token: 'zoom-access',
          refresh_token: 'zoom-refresh',
          token_type: 'Bearer',
          expires_in: 3600
        });
      }

      if (grantType === 'refresh_token') {
        assert.equal(form.get('refresh_token'), 'zoom-refresh');
        return jsonResponse({
          access_token: 'zoom-refreshed-access',
          refresh_token: 'zoom-refresh',
          token_type: 'Bearer',
          expires_in: 3600
        });
      }

      throw new Error(`Unexpected Zoom grant_type: ${grantType}`);
    }

    assert.equal(url.origin, 'https://api.zoom.us');
    if (url.pathname === '/v2/users/me') {
      return jsonResponse({
        id: 'zoom-user-1',
        first_name: 'Maya',
        last_name: 'Lopez',
        email: 'maya@example.com'
      });
    }

    if (url.pathname === '/v2/users/me/meetings') {
      assert.equal(url.searchParams.get('type'), 'scheduled');
      assert.ok(['5', '10'].includes(url.searchParams.get('page_size') ?? ''), 'unexpected Zoom page_size');
      return jsonResponse({
        meetings: [{ id: 'meeting-1', topic: 'Acme Standup' }]
      });
    }

    throw new Error(`Unexpected Zoom request: ${request.method} ${request.url}`);
  }, async () => {
    const tokenSet = await integration.exchangeAuthorizationCode({ code: 'zoom-code', redirectUri });
    assert.equal(tokenSet.accessToken, 'zoom-access');
    assert.equal(tokenSet.refreshToken, 'zoom-refresh');
    assert.ok(tokenSet.expiresAt, 'Zoom token set is missing expiresAt');

    const refreshed = await integration.refreshTokens({ refreshToken: 'zoom-refresh' });
    assert.equal(refreshed.accessToken, 'zoom-refreshed-access');
    assert.equal(refreshed.refreshToken, 'zoom-refresh');

    const account = await integration.resolveAccount(tokenSet);
    assert.equal(account.externalAccountId, 'zoom-user-1');
    assert.equal(account.displayName, 'Maya Lopez');
    assert.equal(account.externalAccountEmail, 'maya@example.com');

    const synced = await integration.syncJobs?.[0]?.run({
      connection: buildConnection({ provider: 'zoom', metadata: {} }),
      credentials: { accessToken: 'zoom-access', refreshToken: 'zoom-refresh', tokenType: 'Bearer', expiresAt: null },
      payload: {}
    });
    assert.equal(synced?.displayName, 'Maya Lopez');
    assert.equal((synced?.metadata as Record<string, unknown>).meetingsPreview ? 1 : 0, 1);

    const meetings = await integration.callTool(
      'zoom.search_meetings',
      { query: 'Acme', type: 'scheduled', limit: 5 },
      {
        connection: buildConnection({ provider: 'zoom', granted_scopes: ['user:read', 'meeting:read', 'recording:read'] }),
        credentials: { accessToken: 'zoom-access', refreshToken: 'zoom-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((meetings as Record<string, unknown>).totalFound, 1);
  });

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.zoom.us');

    if (url.pathname === '/v2/users/me/recordings') {
      assert.equal(url.searchParams.get('page_size'), '5');
      return jsonResponse({
        meetings: [{ id: 'meeting-2', topic: 'Acme Demo' }]
      });
    }

    if (url.pathname === '/v2/meetings/meeting-2/recordings') {
      return jsonResponse({
        topic: 'Acme Demo',
        recording_files: [
          {
            file_type: 'TRANSCRIPT',
            download_url: 'https://api.zoom.us/downloads/meeting-2.vtt'
          }
        ]
      });
    }

    if (url.pathname === '/downloads/meeting-2.vtt') {
      return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      });
    }

    throw new Error(`Unexpected Zoom request: ${request.method} ${request.url}`);
  }, async () => {
    const recordings = await integration.callTool(
      'zoom.list_recordings',
      { query: 'Acme', limit: 5 },
      {
        connection: buildConnection({ provider: 'zoom', granted_scopes: ['user:read', 'meeting:read', 'recording:read'] }),
        credentials: { accessToken: 'zoom-access', refreshToken: 'zoom-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.equal((recordings as Record<string, unknown>).totalFound, 1);

    const transcript = await integration.callTool(
      'zoom.read_transcript',
      { meetingId: 'meeting-2' },
      {
        connection: buildConnection({ provider: 'zoom', granted_scopes: ['user:read', 'meeting:read', 'recording:read'] }),
        credentials: { accessToken: 'zoom-access', refreshToken: 'zoom-refresh', tokenType: 'Bearer', expiresAt: null },
        runtimeContext: { resources: [], prompts: [], skills: [] }
      }
    );
    assert.match(String((transcript as Record<string, unknown>).transcript ?? ''), /Hello/);
  });

  const healthy = integration.health(buildConnection({
    provider: 'zoom',
    display_name: 'Zoom Acme',
    granted_scopes: ['user:read', 'meeting:read', 'recording:read'],
    last_validated_at: '2026-03-23T00:00:00.000Z'
  }));
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.provider, 'zoom');
  assert.equal(integration.health(buildConnection({ provider: 'zoom', granted_scopes: [] })).status, 'attention');
  assert.equal(integration.health(buildConnection({ provider: 'zoom', status: 'reauth_required' })).status, 'reauth_required');
  assert.equal(integration.health(buildConnection({ provider: 'zoom', status: 'revoked' })).status, 'revoked');
}

async function main() {
  ({ getIntegration } = await import('../packages/integrations/src/registry.ts'));
  await testQuickBooks();
  await testXero();
  await testAirtable();
  await testZoom();
  console.log('Finance provider contract checks passed for QuickBooks, Xero, Airtable, and Zoom.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
