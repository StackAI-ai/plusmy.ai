import { googleIntegration } from './providers/google';
import { slackIntegration } from './providers/slack';
import { notionIntegration } from './providers/notion';
import { dropboxIntegration } from './providers/dropbox';
import { boxIntegration } from './providers/box';
import { microsoft365Integration } from './providers/microsoft365';
import { githubIntegration } from './providers/github';
import { linearIntegration } from './providers/linear';
import { jiraIntegration } from './providers/jira';
import { zendeskIntegration } from './providers/zendesk';
import { confluenceIntegration } from './providers/confluence';
import type { IntegrationDefinition } from './types';

const registry = [googleIntegration, slackIntegration, notionIntegration, dropboxIntegration, boxIntegration] as const satisfies readonly IntegrationDefinition[];

export const plannedIntegrationScaffolds = [
  microsoft365Integration,
  githubIntegration,
  linearIntegration,
  jiraIntegration,
  zendeskIntegration,
  confluenceIntegration
] as const satisfies readonly IntegrationDefinition[];

export function getIntegrations() {
  return registry.slice();
}

export function getIntegration(provider: string) {
  return registry.find((integration) => integration.id === provider);
}

export function getPlannedIntegrationScaffold(provider: string) {
  return plannedIntegrationScaffolds.find((integration) => integration.id === provider);
}

export function getPlannedIntegrationScaffolds() {
  return plannedIntegrationScaffolds.slice();
}
