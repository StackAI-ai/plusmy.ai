export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type ConnectionScope = 'workspace' | 'personal';
export type ConnectionStatus = 'pending' | 'active' | 'reauth_required' | 'revoked' | 'error';
export type ProviderId = 'google' | 'slack' | 'notion';
export type ToolCapability = 'read' | 'write' | 'search' | 'execute';
export type ContextAssetType = 'document' | 'prompt' | 'brand_guideline' | 'workflow' | 'knowledge_base';
export type AuditActorType = 'user' | 'mcp_client' | 'system';
export const contextBindingTypes = ['workspace', 'provider', 'tool'] as const;
export type ContextBindingType = (typeof contextBindingTypes)[number];
export type AuditAction = string;

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

export interface ConnectionRecord {
  id: string;
  workspace_id: string;
  owner_user_id: string | null;
  connection_key: string;
  provider: ProviderId;
  scope: ConnectionScope;
  status: ConnectionStatus;
  display_name: string;
  external_account_id: string | null;
  external_account_email: string | null;
  granted_scopes: string[];
  expires_at: string | null;
  reauth_required_reason: string | null;
  metadata: Json;
}

export interface CredentialSecretRefs {
  accessTokenSecretId?: string | null;
  refreshTokenSecretId?: string | null;
  apiKeySecretId?: string | null;
}

export interface ResolvedConnectionCredentials {
  accessToken?: string | null;
  refreshToken?: string | null;
  apiKey?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface ContextBindingReference {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface ContextBindingRecord {
  id: string;
  workspace_id: string;
  binding_type: ContextBindingType;
  target_key: string;
  prompt_template_id: string | null;
  skill_definition_id: string | null;
  priority: number;
  metadata: Json;
  created_at: string;
  updated_at: string;
  prompt_template: ContextBindingReference | null;
  skill_definition: ContextBindingReference | null;
}

export interface AuditLogRecord {
  id: string;
  workspace_id: string;
  actor_type: AuditActorType;
  actor_user_id: string | null;
  actor_client_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  status: string;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  metadata: Json;
  created_at: string;
}

export interface ToolInvocationRecord {
  id: string;
  workspace_id: string;
  connection_id: string | null;
  actor_user_id: string | null;
  actor_client_id: string | null;
  provider: string;
  tool_name: string;
  status: string;
  latency_ms: number | null;
  input: Json;
  output: Json;
  error_message: string | null;
  created_at: string;
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, Json>;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: Json;
  error?: {
    code: number;
    message: string;
    data?: Json;
  };
}

export interface OAuthClientRegistrationInput {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: 'none' | 'client_secret_post' | 'client_secret_basic';
}

export interface DynamicClientRegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: string;
  client_secret?: string;
}

export type OAuthClientApprovalStatus = 'active' | 'revoked';

export interface OAuthClientApprovalRecord {
  id: string;
  client_id: string;
  workspace_id: string;
  user_id: string;
  scopes: string[];
  status: OAuthClientApprovalStatus;
  approved_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
  client_name?: string | null;
  token_endpoint_auth_method?: string | null;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface ProviderTokenSet {
  accessToken?: string | null;
  refreshToken?: string | null;
  apiKey?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
  scopes: string[];
  raw: Json;
}
