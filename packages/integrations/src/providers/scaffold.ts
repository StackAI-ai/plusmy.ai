import type {
  ConnectionRecord,
  Json,
  McpResourceDefinition,
  McpToolDefinition,
  ProviderId,
  ProviderTokenSet
} from '@plusmy/contracts';
import type {
  AuthorizationCodeInput,
  AuthorizationUrlInput,
  IntegrationDefinition,
  ProviderCallContext,
  ResolvedProviderAccount
} from '../types';

type ScaffoldConfig = {
  id: ProviderId;
  displayName: string;
  authorizationUrl: string;
  tokenUrl: string;
  defaultScopes: string[];
  accountLabel: string;
  tools: McpToolDefinition[];
  resources?: McpResourceDefinition[];
};

function placeholderTokenSet(defaultScopes: string[]): ProviderTokenSet {
  return {
    accessToken: 'scaffold-access-token',
    refreshToken: 'scaffold-refresh-token',
    tokenType: 'Bearer',
    expiresAt: null,
    scopes: defaultScopes,
    raw: { scaffold: true } satisfies Json
  };
}

export function createScaffoldIntegration(config: ScaffoldConfig): IntegrationDefinition {
  const oauth = {
    authorizationUrl: config.authorizationUrl,
    tokenUrl: config.tokenUrl,
    defaultScopes: config.defaultScopes
  };

  async function resolveAccount(_tokenSet: ProviderTokenSet): Promise<ResolvedProviderAccount> {
    return {
      externalAccountId: `${config.id}-scaffold-account`,
      displayName: config.accountLabel,
      externalAccountEmail: null,
      metadata: { scaffold: true, provider: config.id }
    };
  }

  return {
    id: config.id,
    displayName: config.displayName,
    oauth,
    buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
      const url = new URL(config.authorizationUrl);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('scope', scopes.join(' '));
      url.searchParams.set('response_type', 'code');
      return url.toString();
    },
    async exchangeAuthorizationCode(_input: AuthorizationCodeInput) {
      return placeholderTokenSet(config.defaultScopes);
    },
    async refreshTokens() {
      return placeholderTokenSet(config.defaultScopes);
    },
    resolveAccount,
    listTools(_connection: ConnectionRecord) {
      return config.tools;
    },
    listResources(_connection: ConnectionRecord) {
      return config.resources ?? [];
    },
    async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
      return {
        provider: config.id,
        scaffold: true,
        toolName,
        input,
        connectionId: context.connection.id,
        runtimeContext: {
          promptCount: context.runtimeContext.prompts.length,
          skillCount: context.runtimeContext.skills.length,
          resourceCount: context.runtimeContext.resources.length
        },
        message: `${config.displayName} is scaffolded in the provider registry but not yet backed by a live API adapter.`
      };
    }
  };
}
