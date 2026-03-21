import { googleIntegration } from './providers/google';
import { slackIntegration } from './providers/slack';
import { notionIntegration } from './providers/notion';
import type { IntegrationDefinition } from './types';

const registry = [googleIntegration, slackIntegration, notionIntegration] as const satisfies readonly IntegrationDefinition[];

export function getIntegrations() {
  return registry.slice();
}

export function getIntegration(provider: string) {
  return registry.find((integration) => integration.id === provider);
}
