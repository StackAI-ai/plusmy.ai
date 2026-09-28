import assert from 'node:assert/strict';
import { sanitizeConnectionMetadata } from '../packages/core/src/connection-metadata.ts';
import { getIntegration } from '../packages/integrations/src/registry.ts';

async function main() {
  const accessToken = 'disposable-access-token-value';
  const refreshToken = 'disposable-refresh-token-value';

  assert.deepEqual(sanitizeConnectionMetadata({
    instanceUrl: 'https://example.test',
    access_token: accessToken,
    authed_user: { accessToken: 'other-user-token', id: 'user-1' },
    raw: { refresh_token: refreshToken },
    note: `Bearer ${accessToken}`,
    items: [{ apiKey: 'other-api-key', name: 'safe' }]
  }, [accessToken, refreshToken]), {
    instanceUrl: 'https://example.test',
    authed_user: { id: 'user-1' },
    items: [{ name: 'safe' }]
  });

  const slack = getIntegration('slack');
  const notion = getIntegration('notion');
  const zendesk = getIntegration('zendesk');
  assert.ok(slack && notion && zendesk);

  const slackAccount = await slack.resolveAccount({
    accessToken,
    refreshToken,
    scopes: ['channels:read'],
    raw: {
      access_token: accessToken,
      refresh_token: refreshToken,
      authed_user: { access_token: 'other-user-token' },
      team: { id: 'team-1', name: 'Disposable team' },
      bot_user_id: 'bot-1'
    }
  });
  assert.deepEqual(slackAccount.metadata, {
    team_id: 'team-1', team_name: 'Disposable team', bot_user_id: 'bot-1'
  });

  const notionAccount = await notion.resolveAccount({
    accessToken,
    refreshToken,
    scopes: ['read'],
    raw: {
      access_token: accessToken,
      refresh_token: refreshToken,
      workspace_id: 'workspace-1',
      workspace_name: 'Disposable workspace',
      bot_id: 'bot-2'
    }
  });
  assert.deepEqual(notionAccount.metadata, {
    workspace_id: 'workspace-1', workspace_name: 'Disposable workspace', bot_id: 'bot-2'
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, 'https://acme.zendesk.com');
    return new Response(JSON.stringify({ user: { id: 123, name: 'Disposable user', email: 'user@example.test' } }), {
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const zendeskAccount = await zendesk.resolveAccount({
      accessToken,
      refreshToken,
      scopes: ['read'],
      raw: {
        access_token: accessToken,
        refresh_token: refreshToken,
        instance_url: 'https://acme.zendesk.com'
      }
    });
    assert.deepEqual(zendeskAccount.metadata, {
      instanceUrl: 'https://acme.zendesk.com', user_id: 123, user_name: 'Disposable user'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Provider metadata credential-boundary contracts passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
