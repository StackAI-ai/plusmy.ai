import Link from 'next/link';
import { Button, Card } from '@plusmy/ui';

const pillars = [
  {
    title: 'Connect once',
    body: 'Install Google, Slack, and Notion once per workspace or per user. Store every token in Vault, not in app tables.'
  },
  {
    title: 'Inject the right context',
    body: 'Prompts, brand rules, and workflows live in pgvector-backed resources so MCP clients only see the most relevant context.'
  },
  {
    title: 'Standard OAuth for MCP',
    body: 'Modern MCP clients authorize against plusmy.ai directly with OAuth 2.1, PKCE, and dynamic client registration.'
  }
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="grid gap-6 rounded-[36px] border border-black/5 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(255,255,255,0.68))] p-8 shadow-panel md:grid-cols-[1.4fr_1fr] md:p-12">
        <div>
          <p className="mb-4 text-sm uppercase tracking-[0.24em] text-slate-600">AI integration control plane</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-ink md:text-6xl">
            One secure surface for your tools, your prompts, and every AI client that needs them.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-700 md:text-lg">
            plusmy.ai centralizes business integrations, encrypts every credential in Supabase Vault, and exposes a single OAuth-native MCP endpoint for OpenAI, Anthropic, Gemini, and any modern client.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
            <Button asChild tone="secondary">
              <Link href="/onboarding">Review onboarding</Link>
            </Button>
          </div>
        </div>
        <Card className="bg-[#13201d] text-white">
          <p className="text-xs uppercase tracking-[0.24em] text-white/60">Launch architecture</p>
          <div className="mt-4 space-y-4 text-sm text-white/80">
            <p>Vercel hosts the app and MCP endpoints.</p>
            <p>Supabase handles auth, Postgres, Vault, pgvector, RLS, pgmq, and internal workers.</p>
            <p>The monorepo shares domain contracts across web, mobile, integrations, and the MCP runtime.</p>
          </div>
        </Card>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {pillars.map((pillar) => (
          <Card key={pillar.title}>
            <h2 className="text-xl font-semibold">{pillar.title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">{pillar.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
