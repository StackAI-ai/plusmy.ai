'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@plusmy/ui';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/workspaces', label: 'Workspaces' },
  { href: '/connections', label: 'Connections' },
  { href: '/context', label: 'Context' },
  { href: '/audit', label: 'Audit' },
  { href: '/mcp-clients', label: 'MCP clients' },
  { href: '/mcp-setup', label: 'MCP setup' },
  { href: '/onboarding', label: 'Onboarding' }
];

type WorkspaceOption = {
  id: string;
  name: string;
  role: string;
  slug: string;
};

function withWorkspace(href: string, workspaceId: string | null, currentSearch: URLSearchParams) {
  const params = new URLSearchParams(currentSearch.toString());
  if (workspaceId) {
    params.set('workspace', workspaceId);
  } else {
    params.delete('workspace');
  }

  const query = params.toString();
  return query ? `${href}?${query}` : href;
}

export function WorkspaceShell({
  userEmail,
  workspaces
}: {
  userEmail: string | null;
  workspaces: WorkspaceOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeWorkspaceId = searchParams.get('workspace') ?? workspaces[0]?.id ?? null;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null;

  function handleWorkspaceChange(nextWorkspaceId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextWorkspaceId) {
      params.set('workspace', nextWorkspaceId);
    } else {
      params.delete('workspace');
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-black/5 bg-white/55 px-4 py-3 text-sm text-slate-700 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          {activeWorkspace ? (
            <>
              <Badge tone="moss">{activeWorkspace.name}</Badge>
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{activeWorkspace.role}</span>
            </>
          ) : (
            <span className="text-sm text-slate-600">No active workspace</span>
          )}
          {workspaces.length ? (
            <select
              aria-label="Select workspace"
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm outline-none"
              value={activeWorkspace?.id ?? ''}
              onChange={(event) => handleWorkspaceChange(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} ({workspace.role})
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {userEmail ? <span className="text-sm text-slate-600">{userEmail}</span> : null}
          <Link
            href={userEmail ? '/logout' : '/login'}
            className="rounded-full border border-black/10 bg-white/80 px-4 py-2 font-medium transition hover:-translate-y-0.5 hover:bg-white"
          >
            {userEmail ? 'Logout' : 'Login'}
          </Link>
        </div>
      </div>
      <nav className="mb-8 flex flex-wrap gap-2 text-sm font-medium text-slate-800">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={withWorkspace(item.href, activeWorkspaceId, new URLSearchParams(searchParams.toString()))}
            className="rounded-full border border-black/10 bg-white/70 px-4 py-2 transition hover:-translate-y-0.5 hover:bg-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
