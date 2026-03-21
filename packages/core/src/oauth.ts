import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { DynamicClientRegistrationResponse, OAuthClientRegistrationInput, OAuthTokenResponse, WorkspaceRecord } from '@plusmy/contracts';
import { createServiceRoleClient } from '@plusmy/supabase';
import { hashOpaqueToken, issueMcpAccessToken } from './auth-context';

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function toScopeString(scope: string[] | string | undefined) {
  if (!scope) return 'mcp:tools mcp:resources';
  return Array.isArray(scope) ? scope.join(' ') : scope;
}

async function validateClientSecret(client: Record<string, unknown>, clientSecret: string | null) {
  const authMethod = String(client.token_endpoint_auth_method ?? 'none');
  if (authMethod === 'none') return;
  if (!clientSecret) throw new Error('Client secret required.');
  const expectedHash = String(client.client_secret_hash ?? '');
  if (hashOpaqueToken(clientSecret) !== expectedHash) {
    throw new Error('Invalid client secret.');
  }
}

function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function assertOAuthClientApprovalActive(input: {
  clientId: string;
  userId: string;
  workspaceId: string;
}) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('oauth_client_approvals')
    .select('status,revoked_at')
    .eq('client_id', input.clientId)
    .eq('user_id', input.userId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle();

  if (!data || data.status !== 'active' || data.revoked_at) {
    throw new Error('OAuth client approval is no longer active.');
  }
}

async function markOAuthClientApprovalUsed(input: {
  clientId: string;
  userId: string;
  workspaceId: string;
}) {
  const supabase = createServiceRoleClient();
  await supabase
    .schema('app')
    .from('oauth_client_approvals')
    .update({ last_used_at: new Date().toISOString() })
    .eq('client_id', input.clientId)
    .eq('user_id', input.userId)
    .eq('workspace_id', input.workspaceId)
    .eq('status', 'active')
    .is('revoked_at', null);
}

export async function getOAuthClient(clientId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.schema('app').from('oauth_clients').select('*').eq('client_id', clientId).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export async function getAuthorizedWorkspace(userId: string, requestedWorkspaceId?: string | null): Promise<WorkspaceRecord | null> {
  const supabase = createServiceRoleClient();
  const { data: memberships } = await supabase
    .schema('app')
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const workspaceId = requestedWorkspaceId ?? memberships?.[0]?.workspace_id;
  if (!workspaceId) return null;
  if (!memberships?.some((membership) => membership.workspace_id === workspaceId)) return null;

  const { data: workspace } = await supabase
    .schema('app')
    .from('workspaces')
    .select('id,name,slug,plan')
    .eq('id', workspaceId)
    .maybeSingle();

  return (workspace as WorkspaceRecord | null) ?? null;
}

export function buildAuthorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:tools', 'mcp:resources'],
    service_documentation: baseUrl
  };
}

export function buildProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:tools', 'mcp:resources']
  };
}

export async function registerDynamicClient(
  input: OAuthClientRegistrationInput,
  createdBy: string | null
): Promise<DynamicClientRegistrationResponse> {
  const supabase = createServiceRoleClient();
  const clientId = nanoid(24);
  const authMethod = input.token_endpoint_auth_method ?? 'none';
  const rawSecret = authMethod === 'none' ? null : nanoid(48);
  const clientSecretHash = rawSecret ? hashOpaqueToken(rawSecret) : null;

  await supabase.schema('app').from('oauth_clients').insert({
    client_id: clientId,
    client_name: input.client_name,
    client_type: authMethod === 'none' ? 'public' : 'confidential',
    redirect_uris: input.redirect_uris,
    grant_types: input.grant_types ?? ['authorization_code', 'refresh_token'],
    response_types: input.response_types ?? ['code'],
    scopes: toScopeString(input.scope).split(' '),
    token_endpoint_auth_method: authMethod,
    client_secret_hash: clientSecretHash,
    created_by: createdBy,
    metadata: input
  });

  return {
    client_id: clientId,
    client_id_issued_at: nowEpoch(),
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    grant_types: input.grant_types ?? ['authorization_code', 'refresh_token'],
    response_types: input.response_types ?? ['code'],
    scope: toScopeString(input.scope),
    token_endpoint_auth_method: authMethod,
    ...(rawSecret ? { client_secret: rawSecret } : {})
  };
}

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  workspaceId: string;
  redirectUri: string;
  scope: string[];
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}) {
  const code = nanoid(48);
  const supabase = createServiceRoleClient();
  await supabase.schema('app').from('oauth_authorization_codes').insert({
    code_hash: hashOpaqueToken(code),
    client_id: input.clientId,
    user_id: input.userId,
    workspace_id: input.workspaceId,
    redirect_uri: input.redirectUri,
    scopes: input.scope,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  return code;
}

async function issueTokenPair(input: {
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
}) {
  const accessToken = await issueMcpAccessToken(
    {
      sub: input.userId,
      clientId: input.clientId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      scopes: input.scopes
    },
    900
  );

  const refreshToken = nanoid(64);
  const refreshTokenHash = hashOpaqueToken(refreshToken);
  const supabase = createServiceRoleClient();
  await supabase.schema('app').from('oauth_refresh_tokens').insert({
    token_hash: refreshTokenHash,
    client_id: input.clientId,
    user_id: input.userId,
    workspace_id: input.workspaceId,
    scopes: input.scopes,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: refreshToken,
    scope: input.scopes.join(' ')
  } satisfies OAuthTokenResponse;
}

export async function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const supabase = createServiceRoleClient();
  const client = await getOAuthClient(input.clientId);
  if (!client) throw new Error('Unknown OAuth client.');
  await validateClientSecret(client, input.clientSecret);

  const { data: codeRow } = await supabase
    .schema('app')
    .from('oauth_authorization_codes')
    .select('*')
    .eq('code_hash', hashOpaqueToken(input.code))
    .maybeSingle();

  if (!codeRow) throw new Error('Authorization code not found.');
  if (codeRow.redirect_uri !== input.redirectUri) throw new Error('Redirect URI mismatch.');
  if (codeRow.consumed_at) throw new Error('Authorization code already consumed.');
  if (new Date(codeRow.expires_at).getTime() < Date.now()) throw new Error('Authorization code expired.');
  await assertOAuthClientApprovalActive({
    clientId: input.clientId,
    userId: String(codeRow.user_id),
    workspaceId: String(codeRow.workspace_id)
  });
  if (codeRow.code_challenge && pkceChallenge(input.codeVerifier) !== codeRow.code_challenge) {
    throw new Error('PKCE verifier mismatch.');
  }

  await supabase
    .schema('app')
    .from('oauth_authorization_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', hashOpaqueToken(input.code));

  const tokenPair = await issueTokenPair({
    clientId: input.clientId,
    userId: String(codeRow.user_id),
    workspaceId: String(codeRow.workspace_id),
    scopes: (codeRow.scopes as string[]) ?? ['mcp:tools', 'mcp:resources']
  });

  await markOAuthClientApprovalUsed({
    clientId: input.clientId,
    userId: String(codeRow.user_id),
    workspaceId: String(codeRow.workspace_id)
  });

  return tokenPair;
}

export async function exchangeRefreshToken(input: {
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
}) {
  const supabase = createServiceRoleClient();
  const client = await getOAuthClient(input.clientId);
  if (!client) throw new Error('Unknown OAuth client.');
  await validateClientSecret(client, input.clientSecret);

  const refreshTokenHash = hashOpaqueToken(input.refreshToken);
  const { data: tokenRow } = await supabase
    .schema('app')
    .from('oauth_refresh_tokens')
    .select('*')
    .eq('token_hash', refreshTokenHash)
    .maybeSingle();

  if (!tokenRow) throw new Error('Refresh token not found.');
  if (tokenRow.revoked_at) throw new Error('Refresh token revoked.');
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) throw new Error('Refresh token expired.');
  await assertOAuthClientApprovalActive({
    clientId: input.clientId,
    userId: String(tokenRow.user_id),
    workspaceId: String(tokenRow.workspace_id)
  });

  const replacement = nanoid(64);
  const replacementHash = hashOpaqueToken(replacement);
  await supabase
    .schema('app')
    .from('oauth_refresh_tokens')
    .update({ revoked_at: new Date().toISOString(), replaced_by_token_hash: replacementHash })
    .eq('token_hash', refreshTokenHash);

  await supabase.schema('app').from('oauth_refresh_tokens').insert({
    token_hash: replacementHash,
    client_id: tokenRow.client_id,
    user_id: tokenRow.user_id,
    workspace_id: tokenRow.workspace_id,
    scopes: tokenRow.scopes,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });

  const accessToken = await issueMcpAccessToken(
    {
      sub: String(tokenRow.user_id),
      clientId: String(tokenRow.client_id),
      workspaceId: String(tokenRow.workspace_id),
      userId: String(tokenRow.user_id),
      scopes: (tokenRow.scopes as string[]) ?? ['mcp:tools', 'mcp:resources']
    },
    900
  );

  await markOAuthClientApprovalUsed({
    clientId: input.clientId,
    userId: String(tokenRow.user_id),
    workspaceId: String(tokenRow.workspace_id)
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: replacement,
    scope: ((tokenRow.scopes as string[]) ?? ['mcp:tools', 'mcp:resources']).join(' ')
  } satisfies OAuthTokenResponse;
}
