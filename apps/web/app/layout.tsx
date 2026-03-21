import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Badge } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { listUserWorkspaces } from '@plusmy/core';
import { WorkspaceShell } from './_components/workspace-shell';

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
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-10 flex flex-col gap-4 rounded-[28px] border border-black/5 bg-white/60 p-5 shadow-panel backdrop-blur md:flex-row md:items-center md:justify-between">
            <div>
              <Link href="/" className="text-2xl font-semibold tracking-tight">
                plusmy.ai
              </Link>
              <p className="mt-1 text-sm text-slate-700">
                Secure business integrations, shared AI context, and a single MCP endpoint.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge>OAuth-native MCP</Badge>
              <Badge tone="moss">Vault-backed secrets</Badge>
              <Badge tone="brass">Workspace-first RLS</Badge>
            </div>
          </header>
          <WorkspaceShell
            userEmail={user?.email ?? null}
            workspaces={workspaces.map((workspace) => ({
              id: workspace.id,
              name: workspace.name,
              role: workspace.role,
              slug: workspace.slug
            }))}
          />
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
