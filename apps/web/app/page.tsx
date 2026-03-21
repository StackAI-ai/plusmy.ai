import Link from 'next/link';
import { ArrowRight, BrainCircuit, Cable, ShieldCheck, Waypoints } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import { getPlatformCounts, plannedProviderPlatforms, supportedProviders } from '@plusmy/contracts';

const pillars = [
  {
    icon: Cable,
    title: 'Connect once',
    body: 'Install Google, Slack, and Notion once per workspace or per user. Store every token in Vault, not in app tables.'
  },
  {
    icon: BrainCircuit,
    title: 'Inject the right context',
    body: 'Prompts, brand rules, and workflows live in pgvector-backed resources so MCP clients only see the most relevant context.'
  },
  {
    icon: ShieldCheck,
    title: 'Standard OAuth for MCP',
    body: 'Modern MCP clients authorize against plusmy.ai directly with OAuth 2.1, PKCE, and dynamic client registration.'
  }
];

export default function HomePage() {
  const counts = getPlatformCounts();

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[36px] border border-border/60 bg-card/75 p-8 shadow-glow backdrop-blur-xl md:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,114,47,0.2),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(63,126,97,0.14),transparent_28%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div>
            <div className="mb-5 flex flex-wrap gap-2">
              <Badge>
                <Waypoints className="h-3.5 w-3.5" />
                AI integration control plane
              </Badge>
              <Badge tone="moss">Vault-backed</Badge>
              <Badge tone="brass">Workspace-scoped</Badge>
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-foreground md:text-6xl">
              A real operator layer for AI clients, not another prompt scrapbook.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
              plusmy.ai centralizes business integrations, encrypts every credential in Supabase Vault, and exposes a single OAuth-native MCP endpoint for OpenAI, Anthropic, Gemini, Cursor, and every modern client that needs governed access.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/onboarding">Review onboarding</Link>
              </Button>
            </div>
          </div>
          <Card className="border-border/70 bg-background/80">
            <CardHeader>
              <CardTitle>Launch architecture</CardTitle>
              <CardDescription>Designed like a modern shadcn-based operator app, but wired to the actual product model underneath.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <p className="font-medium text-foreground">Vercel + Next.js App Router</p>
                <p className="mt-2 leading-6">User-facing product surfaces and MCP endpoints stay on the web app, not in disconnected admin tooling.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <p className="font-medium text-foreground">Supabase core runtime</p>
                <p className="mt-2 leading-6">Auth, Postgres, Vault, pgvector, RLS, queues, and internal worker routes stay aligned with the build plan.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <p className="font-medium text-foreground">Shared contracts and UI primitives</p>
                <p className="mt-2 leading-6">The monorepo uses shared packages so web, mobile, integrations, and MCP runtime stay on the same interface layer.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {pillars.map((pillar) => {
          const Icon = pillar.icon;

          return (
            <Card key={pillar.title}>
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary text-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="pt-2">{pillar.title}</CardTitle>
                <CardDescription>{pillar.body}</CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap gap-2">
              <Badge tone="moss">{counts.liveProviders} providers live</Badge>
              <Badge>{counts.supportedClients} client targets</Badge>
              <Badge tone="brass">{counts.plannedPlatforms} next-wave integrations</Badge>
            </div>
            <CardTitle>Supported now</CardTitle>
            <CardDescription>
              The product is currently implemented for three provider surfaces: Google Workspace, Slack, and
              Notion. Each one already flows through workspace-aware OAuth, Vault-backed credential storage, and
              MCP tool exposure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {supportedProviders.map((provider) => (
              <div key={provider.id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">{provider.name}</p>
                  <Badge tone="moss">live</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{provider.summary}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coming next</CardTitle>
            <CardDescription>
              The most obvious gaps are enterprise document suites, engineering systems, CRM, and support
              tooling. Those can fit the existing workspace + approval model without changing the architecture.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {plannedProviderPlatforms.slice(0, 6).map((platform) => (
                <div key={platform.id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">{platform.name}</p>
                    <Badge tone="brass">planned</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{platform.rationale}</p>
                </div>
              ))}
            </div>
            <Button asChild variant="outline">
              <Link href="/platforms">
                Review platform catalog
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
