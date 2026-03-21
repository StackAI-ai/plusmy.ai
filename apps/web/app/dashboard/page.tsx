import { Card, Badge } from '@plusmy/ui'
import { createServerSupabaseClient } from '@plusmy/supabase'
import { getAuthorizedWorkspace, getWorkspaceOverview, listUserWorkspaces } from '@plusmy/core'
import { getSearchParam, type AppSearchParams } from '../_lib/search-params'

export default async function DashboardPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Sign in required</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          The dashboard reads live workspace state from Supabase Auth and the `app` schema. Sign in before creating a workspace or attaching integrations.
        </p>
      </Card>
    )
  }

  const workspaces = await listUserWorkspaces(user.id)
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace')
  const activeWorkspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId)
  const overview = activeWorkspace ? await getWorkspaceOverview(activeWorkspace.id, user.id) : null

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Workspace control plane</h1>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Live view of the selected workspace, its integration footprint, and the shared prompt and skill surface behind the MCP server.
            </p>
          </div>
          <Badge tone="moss">{activeWorkspace ? activeWorkspace.name : 'No workspace yet'}</Badge>
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Workspaces</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{workspaces.length}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Connections</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.connections ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Prompt templates</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.prompts ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Skill definitions</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.skills ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Context assets</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.assets ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Binding rules</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.bindings ?? 0}</p>
        </Card>
      </section>

      <Card>
        <h2 className="text-xl font-semibold">What is wired</h2>
        <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
          <li>Supabase Auth for human users and workspace membership</li>
          <li>OAuth 2.1 + PKCE endpoints for MCP clients</li>
          <li>Vault-backed secret references for provider tokens</li>
          <li>pgvector-backed context ingestion and prompt resources</li>
        </ul>
      </Card>
    </div>
  )
}
