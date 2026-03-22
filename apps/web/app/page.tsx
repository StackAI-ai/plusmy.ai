import Link from 'next/link';
import { ArrowRight, BrainCircuit, Cable, ShieldCheck, UsersRound } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { getPlatformCounts, plannedProviderPlatforms, supportedProviders } from '@plusmy/contracts';

const pillars = [
  {
    icon: Cable,
    title: 'Connect once',
    body: 'Connect providers once per workspace or per user. Secrets are stored securely and never written to app tables.'
  },
  {
    icon: BrainCircuit,
    title: 'Keep context on-brand',
    body: 'Prompts, policies, and workflows live as reusable resources so assistants see the right context for the job.'
  },
  {
    icon: ShieldCheck,
    title: 'Controlled access',
    body: 'Workspace approvals and an audit trail keep every tool action reviewable.'
  }
];

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const counts = getPlatformCounts();

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[36px] border border-border/60 bg-card/75 p-8 shadow-glow backdrop-blur-xl md:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,114,47,0.2),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(63,126,97,0.14),transparent_28%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div>
            <div className="mb-5 flex flex-wrap gap-2">
              <Badge>
                <UsersRound className="h-3.5 w-3.5" />
                Business tool hub
              </Badge>
              <Badge tone="moss">Secure by default</Badge>
              <Badge tone="brass">Workspace permissions</Badge>
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-foreground md:text-6xl">
              Connect your business tools, not your stack.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground md:text-lg">
              plusmy.ai runs operator workflows across CRM, support, finance, docs, and collaboration with clear workspace permissions and
              audit-ready approvals.
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
              <Button asChild variant="outline" size="lg">
                <Link href="/mcp-setup/quickstart">Open AI client quickstart</Link>
              </Button>
            </div>
          </div>
          <Card className="border-border/70 bg-background/80">
            <CardHeader>
              <CardTitle>Built for operators</CardTitle>
              <CardDescription>Connect tools once, then run repeatable workflows with clear permissions and an audit trail.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <p className="font-medium text-foreground">CRM, support, finance, collaboration</p>
                <p className="mt-2 leading-6">Run customer and ops workflows across tools without juggling separate permissions models.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <p className="font-medium text-foreground">Context first</p>
                <p className="mt-2 leading-6">Saved prompts and assets stay attached to the workspace so operators get relevant context immediately.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card/90 p-4">
                <p className="font-medium text-foreground">Scales with your catalog</p>
                <p className="mt-2 leading-6">Adding a provider means it lands in the same model with consistent approvals and auditability.</p>
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
              <Badge>{counts.supportedClients} AI clients</Badge>
              <Badge tone="brass">{counts.plannedPlatforms} next-wave integrations</Badge>
            </div>
            <CardTitle>Supported now</CardTitle>
            <CardDescription>
              Live providers cover CRM, support, delivery, identity, and documentation workflows.
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
              QuickBooks, Xero, Airtable, and Zoom are next, keeping the same workspace permissions and approval flow.
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
