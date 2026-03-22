import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import {
  getPlatformCategoryCounts,
  getPlatformCounts,
  plannedProviderPlatforms,
  supportedMcpClients,
  supportedProviders
} from '@plusmy/contracts';

type PlannedPlatform = (typeof plannedProviderPlatforms)[number];

const plannedCategoryOrder: PlannedPlatform['category'][] = [
  'documents',
  'engineering',
  'knowledge',
  'project_management',
  'crm',
  'support',
  'productivity',
  'identity'
];

const categoryLabels: Record<PlannedPlatform['category'], string> = {
  documents: 'Documents',
  engineering: 'Engineering',
  knowledge: 'Knowledge',
  project_management: 'Project management',
  crm: 'CRM',
  support: 'Support',
  productivity: 'Productivity',
  identity: 'Identity'
};

const highValueMissingPlatformIds = ['hubspot', 'salesforce', 'servicenow', 'okta', 'asana', 'monday', 'microsoft-365', 'github'];

const plannedPlatformsByCategory = plannedProviderPlatforms.reduce<Record<PlannedPlatform['category'], PlannedPlatform[]>>(
  (groups, platform) => {
    const group = groups[platform.category] ?? [];
    group.push(platform);
    groups[platform.category] = group;
    return groups;
  },
  {} as Record<PlannedPlatform['category'], PlannedPlatform[]>
);

const highValueMissingPlatforms = highValueMissingPlatformIds
  .map((platformId) => plannedProviderPlatforms.find((platform) => platform.id === platformId))
  .filter((platform): platform is PlannedPlatform => Boolean(platform));

export default function PlatformsPage() {
  const counts = getPlatformCounts();
  const categoryCounts = getPlatformCategoryCounts();

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader className="relative gap-4">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,114,47,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(63,126,97,0.12),transparent_28%)]" />
          <div className="relative space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="moss">{counts.liveProviders} live providers</Badge>
              <Badge>{counts.supportedClients} MCP client targets</Badge>
              <Badge tone="brass">{counts.plannedPlatforms} planned integrations</Badge>
              <Badge>{Object.keys(categoryCounts).length} reviewed categories</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {plannedCategoryOrder
                .filter((category) => (plannedPlatformsByCategory[category]?.length ?? 0) > 0)
                .map((category) => (
                  <Badge key={category}>
                    {categoryLabels[category]} · {plannedPlatformsByCategory[category].length}
                  </Badge>
                ))}
            </div>
            <CardTitle className="text-3xl">Platform coverage</CardTitle>
            <CardDescription className="max-w-3xl">
              plusmy.ai is live today on Google Workspace, Slack, Notion, Dropbox, and Box. The reviewed next wave expands into
              Microsoft 365, engineering systems, knowledge bases, project management, CRM, support, storage,
              productivity, and identity platforms without changing the current workspace-scoped OAuth and Vault
              model.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Live providers</h2>
            <p className="text-sm text-muted-foreground">These integrations are implemented in the provider registry today.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/connections">
              Open connections
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {supportedProviders.map((provider) => (
            <Card key={provider.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{provider.name}</CardTitle>
                  <Badge tone="moss">live</Badge>
                </div>
                <CardDescription>{provider.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge>{provider.category.replaceAll('_', ' ')}</Badge>
                <div className="space-y-2">
                  {provider.capabilities.map((capability) => (
                    <div key={capability.label} className="rounded-2xl border border-border/60 bg-background/70 p-3">
                      <p className="font-medium text-foreground">{capability.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{capability.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">MCP client targets</h2>
          <p className="text-sm text-muted-foreground">Standards-based compatibility for the tools and apps operators actually use.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {supportedMcpClients.map((client) => (
            <Card key={client.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{client.name}</CardTitle>
                  <Badge>{client.status}</Badge>
                </div>
                <CardDescription>{client.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {client.capabilities.map((capability) => (
                  <div key={capability.label} className="rounded-2xl border border-border/60 bg-background/70 p-3">
                    <p className="font-medium text-foreground">{capability.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{capability.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Highest-value missing platforms</h2>
          <p className="text-sm text-muted-foreground">
            These are the clearest next additions if we want broader enterprise adoption without changing the current trust model.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {highValueMissingPlatforms.map((platform) => (
            <Card key={platform.id}>
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-lg">{platform.name}</CardTitle>
                  <Badge tone="brass">planned</Badge>
                </div>
                <CardDescription>{platform.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{platform.rationale}</p>
                <div className="space-y-2">
                  {platform.capabilities.map((capability) => (
                    <div key={capability.label} className="rounded-2xl border border-border/60 bg-background/70 p-3">
                      <p className="font-medium text-foreground">{capability.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{capability.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Next-wave integrations</h2>
          <p className="text-sm text-muted-foreground">
            Reviewed gaps grouped by the same tenant and authorization model as the live providers.
          </p>
        </div>
        <div className="space-y-4">
          {plannedCategoryOrder
            .filter((category) => (plannedPlatformsByCategory[category]?.length ?? 0) > 0)
            .map((category) => (
              <Card key={category}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                  <div className="space-y-1">
                    <CardTitle>{categoryLabels[category]}</CardTitle>
                    <CardDescription>{plannedPlatformsByCategory[category].length} reviewed platform(s)</CardDescription>
                  </div>
                  <Badge tone="brass">{category.replaceAll('_', ' ')}</Badge>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-2">
                  {plannedPlatformsByCategory[category].map((platform) => (
                    <div key={platform.id} className="rounded-2xl border border-border/70 bg-background/70 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-semibold text-foreground">{platform.name}</p>
                        <Badge tone="brass">planned</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{platform.summary}</p>
                      <p className="mt-2 text-sm text-muted-foreground">{platform.rationale}</p>
                      <div className="mt-3 space-y-2">
                        {platform.capabilities.map((capability) => (
                          <div key={capability.label} className="rounded-xl border border-border/60 bg-card/80 p-3">
                            <p className="text-sm font-medium text-foreground">{capability.label}</p>
                            <p className="mt-1 text-xs leading-6 text-muted-foreground">{capability.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
        </div>
      </section>
    </div>
  );
}
