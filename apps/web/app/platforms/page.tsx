import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import { getPlatformCounts, plannedProviderPlatforms, supportedMcpClients, supportedProviders } from '@plusmy/contracts';

export default function PlatformsPage() {
  const counts = getPlatformCounts();

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
            </div>
            <CardTitle className="text-3xl">Platform coverage</CardTitle>
            <CardDescription className="max-w-3xl">
              plusmy.ai is live today on Google Workspace, Slack, and Notion. The next wave should expand into
              Microsoft 365, engineering systems, CRM, support, and operational databases without changing the
              current workspace-scoped OAuth and Vault model.
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
          <h2 className="text-2xl font-semibold text-foreground">Next-wave integrations</h2>
          <p className="text-sm text-muted-foreground">Reviewed gaps with clear rationale for why they fit the current architecture.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plannedProviderPlatforms.map((platform) => (
            <Card key={platform.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>{platform.name}</CardTitle>
                  <Badge tone="brass">planned</Badge>
                </div>
                <CardDescription>{platform.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge>{platform.category.replaceAll('_', ' ')}</Badge>
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
    </div>
  );
}
