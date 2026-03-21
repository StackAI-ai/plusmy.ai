import type {
  ProviderRuntimeContext,
  ConnectionRecord,
  McpResourceDefinition,
  McpToolDefinition,
  ProviderId,
  ProviderTokenSet,
  ResolvedConnectionCredentials
} from '@plusmy/contracts';

export interface AuthorizationUrlInput {
  redirectUri: string;
  state: string;
  scopes: string[];
}

export interface AuthorizationCodeInput {
  code: string;
  redirectUri: string;
}

export interface RefreshTokenInput {
  refreshToken: string;
}

export interface ResolvedProviderAccount {
  externalAccountId: string;
  displayName: string;
  externalAccountEmail?: string | null;
  metadata: Record<string, unknown>;
}

export interface ProviderCallContext {
  connection: ConnectionRecord;
  credentials: ResolvedConnectionCredentials;
  runtimeContext: ProviderRuntimeContext;
}

export interface ToolFactory {
  (connection: ConnectionRecord): Promise<McpToolDefinition[]> | McpToolDefinition[];
}

export interface ResourceFactory {
  (connection: ConnectionRecord): Promise<McpResourceDefinition[]> | McpResourceDefinition[];
}

export interface TokenRefresher {
  (input: RefreshTokenInput): Promise<ProviderTokenSet>;
}

export interface ConnectionValidator {
  (tokenSet: ProviderTokenSet): Promise<ResolvedProviderAccount>;
}

export interface SyncJobHandler {
  jobType: string;
  run(connection: ConnectionRecord): Promise<void>;
}

export interface WebhookHandler {
  eventType: string;
  handle(payload: unknown): Promise<void>;
}

export interface IntegrationDefinition {
  id: ProviderId;
  displayName: string;
  oauth: {
    authorizationUrl: string;
    tokenUrl: string;
    defaultScopes: string[];
  };
  buildAuthorizationUrl(input: AuthorizationUrlInput): string;
  exchangeAuthorizationCode(input: AuthorizationCodeInput): Promise<ProviderTokenSet>;
  refreshTokens: TokenRefresher;
  resolveAccount: ConnectionValidator;
  listTools: ToolFactory;
  listResources: ResourceFactory;
  callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext): Promise<unknown>;
  syncJobs?: SyncJobHandler[];
  webhooks?: WebhookHandler[];
}
