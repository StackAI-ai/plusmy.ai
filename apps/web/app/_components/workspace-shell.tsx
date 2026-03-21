'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, buttonVariants, cn } from '@plusmy/ui';
import { Activity, Bot, BookText, Cable, LayoutDashboard, Rocket, Users, Waypoints } from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/workspaces', label: 'Workspaces', icon: Users },
  { href: '/connections', label: 'Connections', icon: Cable },
  { href: '/context', label: 'Context', icon: BookText },
  { href: '/audit', label: 'Audit', icon: Activity },
  { href: '/mcp-clients', label: 'MCP clients', icon: Bot },
  { href: '/mcp-setup', label: 'MCP setup', icon: Waypoints },
  { href: '/onboarding', label: 'Onboarding', icon: Rocket }
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
      <div className="mb-5 flex flex-col gap-4 rounded-[28px] border border-border/60 bg-card/70 p-4 shadow-panel backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
          {activeWorkspace ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="moss">{activeWorkspace.name}</Badge>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{activeWorkspace.role}</span>
              <span className="font-mono text-xs text-muted-foreground">{activeWorkspace.slug}</span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No active workspace</span>
          )}
          {workspaces.length ? (
            <div className="w-full max-w-sm">
              <Select value={activeWorkspace?.id} onValueChange={handleWorkspaceChange}>
                <SelectTrigger aria-label="Select workspace" className="bg-background/70">
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name} ({workspace.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {userEmail ? <span className="font-mono text-xs text-muted-foreground sm:text-sm">{userEmail}</span> : null}
          <Button asChild variant="outline" size="sm">
            <Link href={userEmail ? '/logout' : '/login'}>{userEmail ? 'Logout' : 'Login'}</Link>
          </Button>
        </div>
      </div>
      <nav className="mb-8 flex flex-wrap gap-2">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={withWorkspace(item.href, activeWorkspaceId, new URLSearchParams(searchParams.toString()))}
              className={cn(
                buttonVariants({ variant: active ? 'default' : 'ghost', size: 'sm' }),
                'rounded-full px-4',
                !active && 'border border-border/60 bg-card/55'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
