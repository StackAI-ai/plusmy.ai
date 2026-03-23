import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getPlatformCategoryCounts,
  getPlatformCounts,
  plannedProviderPlatforms,
  supportedMcpClients,
  supportedProviders,
  type PlatformCategory
} from '@plusmy/contracts';

type PlannedPlatform = (typeof plannedProviderPlatforms)[number];

const plannedCategoryOrder: PlatformCategory[] = [
  'documents',
  'engineering',
  'knowledge',
  'project_management',
  'crm',
  'support',
  'finance',
  'productivity',
  'identity'
];

const categoryLabels: Record<PlatformCategory, string> = {
  chat: 'Chat',
  documents: 'Documents',
  engineering: 'Engineering',
  knowledge: 'Knowledge',
  project_management: 'Project management',
  crm: 'CRM',
  support: 'Support',
  finance: 'Finance',
  storage: 'Storage',
  productivity: 'Productivity',
  identity: 'Identity'
};

const businessCategoryOrder: PlatformCategory[] = ['crm', 'support', 'finance', 'project_management', 'productivity', 'identity', 'documents'];

const highValueMissingPlatformIds = ['quickbooks', 'xero', 'airtable', 'zoom'];

const plannedPlatformsByCategory = plannedProviderPlatforms.reduce<Record<PlatformCategory, PlannedPlatform[]>>(
  (groups, platform) => {
    const group = groups[platform.category] ?? [];
    group.push(platform);
    groups[platform.category] = group;
    return groups;
  },
  {} as Record<PlatformCategory, PlannedPlatform[]>
);

const highValueMissingPlatforms = highValueMissingPlatformIds
  .map((platformId) => plannedProviderPlatforms.find((platform) => platform.id === platformId))
  .filter((platform): platform is PlannedPlatform => Boolean(platform));

export default async function PlatformsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const counts = getPlatformCounts();
  const categoryCounts = getPlatformCategoryCounts();
  const hasPlannedProviders = plannedProviderPlatforms.length > 0;
  const highPriorityBusinessPlatforms = supportedProviders
    .filter((provider) => businessCategoryOrder.includes(provider.category))
    .sort((left, right) => {
      const leftIndex = businessCategoryOrder.indexOf(left.category);
      const rightIndex = businessCategoryOrder.indexOf(right.category);
      return leftIndex === rightIndex ? left.name.localeCompare(right.name) : leftIndex - rightIndex;
    });

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader className="relative gap-4">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,114,47,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(63,126,97,0.12),transparent_28%)]" />
          <div className="relative space-y-3">
	            <div className="flex flex-wrap gap-2">
	              <Badge tone="moss">{counts.liveProviders} live providers</Badge>
	              <Badge>{counts.supportedClients} AI clients</Badge>
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
              plusmy.ai is built for business workflows with live CRM, support, finance, delivery, identity, document, and engineering providers.
              {hasPlannedProviders
                ? ' Planned additions stay focused on the highest-value operator gaps that fit the same security model.'
                : ' Current focus is hardening the live catalog, client onboarding, and context quality for private beta.'}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Business tools first</h2>
          <p className="text-sm text-muted-foreground">
            CRM, support, finance, operations, identity, and document workflows stay front and center for operator workloads.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {highPriorityBusinessPlatforms.map((provider) => (
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
                <p className="text-sm text-muted-foreground">
                  {provider.capabilities.map((capability) => capability.label).join(' · ')}
                </p>
              </CardContent>
            </Card>
          ))}
          {!hasPlannedProviders ? (
            <Card>
              <CardHeader>
                <CardTitle>Private beta hardening</CardTitle>
                <CardDescription>The remaining work is quality-focused: validation, client access polish, and clearer operator context.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
                  <p className="font-medium text-foreground">Provider reliability</p>
                  <p className="text-sm text-muted-foreground">Keep auth refresh, health snapshots, and sync behavior consistent across the live catalog.</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
                  <p className="font-medium text-foreground">Client onboarding</p>
                  <p className="text-sm text-muted-foreground">Make AI-client setup readable for operators without exposing protocol-heavy detail by default.</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
                  <p className="font-medium text-foreground">Context quality</p>
                  <p className="text-sm text-muted-foreground">Improve prompt, skill, and asset grounding so workflows are useful immediately after connection.</p>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
	          <div>
	            <h2 className="text-2xl font-semibold text-foreground">Live providers</h2>
	            <p className="text-sm text-muted-foreground">Connect these integrations today and use them across your workflows.</p>
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
	          <h2 className="text-2xl font-semibold text-foreground">AI client support</h2>
	          <p className="text-sm text-muted-foreground">Connect common assistants and operator apps with secure sign-in and workspace permissions.</p>
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

      {hasPlannedProviders ? (
        <section className="space-y-4">
	        <div>
	          <h2 className="text-2xl font-semibold text-foreground">Highest-value next additions</h2>
	          <p className="text-sm text-muted-foreground">
	            These are the short-list priorities for finance, sales, and operational tooling while preserving the current security posture.
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
      ) : null}

      {hasPlannedProviders ? (
	      <section className="space-y-4">
	        <div>
	          <h2 className="text-2xl font-semibold text-foreground">Next-wave integrations</h2>
	          <p className="text-sm text-muted-foreground">Reviewed gaps grouped by the same workspace permissions model as the live providers.</p>
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
      ) : null}
    </div>
  );
}
