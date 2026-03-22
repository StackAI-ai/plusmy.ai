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
import { hubspotIntegration } from './providers/hubspot';
import { salesforceIntegration } from './providers/salesforce';
import { servicenowIntegration } from './providers/servicenow';
import { oktaIntegration } from './providers/okta';
import { asanaIntegration } from './providers/asana';
import { mondayIntegration } from './providers/monday';
import type { IntegrationDefinition } from './types';

const registry = [
  googleIntegration,
  slackIntegration,
  notionIntegration,
  dropboxIntegration,
  boxIntegration,
  confluenceIntegration,
  zendeskIntegration,
  hubspotIntegration,
  salesforceIntegration,
  servicenowIntegration,
  oktaIntegration,
  asanaIntegration,
  mondayIntegration,
  microsoft365Integration,
  githubIntegration,
  linearIntegration,
  jiraIntegration
] as const satisfies readonly IntegrationDefinition[];

export const plannedIntegrationScaffolds = [
  // Placeholder for future platform expansion outside current live provider surface.
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
