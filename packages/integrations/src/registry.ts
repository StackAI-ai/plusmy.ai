import { googleIntegration } from './providers/google';
import { slackIntegration } from './providers/slack';
import { notionIntegration } from './providers/notion';
import { dropboxIntegration } from './providers/dropbox';
import { boxIntegration } from './providers/box';
import { airtableIntegration } from './providers/airtable';
import { zoomIntegration } from './providers/zoom';
import { microsoft365Integration } from './providers/microsoft365';
import { githubIntegration } from './providers/github';
import { linearIntegration } from './providers/linear';
import { jiraIntegration } from './providers/jira';
import { zendeskIntegration } from './providers/zendesk';
import { confluenceIntegration } from './providers/confluence';
import { hubspotIntegration } from './providers/hubspot';
import { salesforceIntegration } from './providers/salesforce';
import { serviceNowIntegration } from './providers/servicenow';
import { oktaIntegration } from './providers/okta';
import { asanaIntegration } from './providers/asana';
import { mondayIntegration } from './providers/monday';
import { quickbooksIntegration } from './providers/quickbooks';
import { xeroIntegration } from './providers/xero';
import type { IntegrationDefinition } from './types';

const registry: readonly IntegrationDefinition[] = [
  googleIntegration,
  slackIntegration,
  notionIntegration,
  dropboxIntegration,
  boxIntegration,
  airtableIntegration,
  zoomIntegration,
  confluenceIntegration,
  zendeskIntegration,
  hubspotIntegration,
  salesforceIntegration,
  serviceNowIntegration,
  oktaIntegration,
  asanaIntegration,
  mondayIntegration,
  microsoft365Integration,
  githubIntegration,
  linearIntegration,
  jiraIntegration,
  quickbooksIntegration,
  xeroIntegration
] as const;

export const plannedIntegrationScaffolds: readonly IntegrationDefinition[] = [];

export function getIntegrations(): IntegrationDefinition[] {
  return registry.slice();
}

export function getIntegration(provider: string): IntegrationDefinition | undefined {
  return registry.find((integration) => integration.id === provider);
}

export function getPlannedIntegrationScaffold(provider: string): IntegrationDefinition | undefined {
  return plannedIntegrationScaffolds.find((integration) => integration.id === provider);
}

export function getPlannedIntegrationScaffolds(): IntegrationDefinition[] {
  return plannedIntegrationScaffolds.slice();
}
