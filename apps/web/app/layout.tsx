import type { Metadata } from 'next';
import Link from 'next/link';
import { IBM_Plex_Mono, Manrope } from 'next/font/google';
import './globals.css';
import { Badge } from '@plusmy/ui';
import { Network, ShieldCheck, Sparkles } from 'lucide-react';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { listUserWorkspaces } from '@plusmy/core';
import { WorkspaceShell } from './_components/workspace-shell';

const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sans'
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500']
});

export const metadata: Metadata = {
  title: 'plusmy.ai',
  description: 'Universal context, secure integrations, and OAuth-native MCP for AI teams.'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const workspaces = user ? await listUserWorkspaces(user.id) : [];

  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-8 overflow-hidden rounded-[32px] border border-border/60 bg-card/75 p-6 shadow-glow backdrop-blur-xl md:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  Workspace-native AI operations
                </div>
                <Link href="/" className="mt-4 block text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  plusmy.ai
                </Link>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                  Secure business integrations, shared AI context, and a single OAuth-native MCP endpoint for every operator, client, and workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:max-w-xl lg:justify-end">
                <Badge>
                  <Network className="h-3.5 w-3.5" />
                  OAuth-native MCP
                </Badge>
                <Badge tone="moss">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Vault-backed secrets
                </Badge>
                <Badge tone="brass">
                  <Sparkles className="h-3.5 w-3.5" />
                  Workspace-first RLS
                </Badge>
              </div>
            </div>
          </header>
          <div className="relative flex-1">
            <div className="absolute inset-x-0 top-0 -z-10 h-48 rounded-[32px] bg-[radial-gradient(circle_at_top,rgba(244,114,47,0.14),transparent_62%)] blur-3xl" />
            <WorkspaceShell
              userEmail={user?.email ?? null}
              workspaces={workspaces.map((workspace) => ({
                id: workspace.id,
                name: workspace.name,
                role: workspace.role,
                slug: workspace.slug
              }))}
            />
            <main className="flex-1 pb-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
